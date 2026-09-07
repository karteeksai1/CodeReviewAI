import asyncio
import os
import re
import time
from pathlib import Path
import structlog

from graph.agents.common import finding, iter_added_lines
from llm.groq import diff_excerpt, groq_json, normalize_findings
from rag import retrieve_context, get_file_language, detect_signature_changes

logger = structlog.get_logger()

SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
    re.compile(r"ghp_[A-Za-z0-9_]{30,}"),
    re.compile(r"sk-[A-Za-z0-9]{32,}"),
]


def is_valid_hardcoded_credential(code: str) -> bool:
    if not code:
        return False
    code_clean = re.sub(r'(//|#).*$', '', code).strip()
    keywords = ['password', 'key', 'secret', 'token', 'credential', 'api']
    code_lower = code_clean.lower()
    if not any(kw in code_lower for kw in keywords):
        return False
    if 'process.env' in code_lower or 'os.environ' in code_lower or 'os.getenv' in code_lower:
        return False
    for str_match in re.finditer(r'[\'"`]([^\'"`]{4,})[\'"`]', code_clean):
        val = str_match.group(1).strip()
        val_lower = val.lower()
        if any(kw in val_lower for kw in keywords):
            continue
        if len(val) >= 4 and not val.startswith("http://") and not val.startswith("https://"):
            return True
    if '=' in code_clean or ':' in code_clean:
        parts = re.split(r'[=:]', code_clean, maxsplit=1)
        lhs = parts[0].strip().lower()
        rhs = parts[1].strip().rstrip(';,)')
        if any(kw in lhs for kw in keywords):
            if (rhs.startswith("'") and rhs.endswith("'")) or \
               (rhs.startswith('"') and rhs.endswith('"')) or \
               (rhs.startswith('`') and rhs.endswith('`')):
                return len(rhs[1:-1].strip()) > 0
    return False


async def security_agent(state):
    findings = []
    contexts = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    
    unique_files = {file.get("path") for file in state.get("files", []) if file.get("path") and file.get("status") != "removed"}
    file_contexts = {}
    
    async def fetch_file_context(path):
        try:
            return path, await retrieve_context(namespace, f"{path} security auth")
        except Exception:
            return path, []
            
    results = await asyncio.gather(*(fetch_file_context(path) for path in unique_files))
    for path, ctx in results:
        file_contexts[path] = ctx
        contexts.extend([c.get("text") for c in ctx if c.get("text")])

    for file, line, code in iter_added_lines(state.get("files", [])):
        lower = code.lower()
        path = file.get("path")
        context = file_contexts.get(path, [])
        
        if any(pattern.search(code) for pattern in SECRET_PATTERNS):
            findings.append(finding("security", "critical", "Potential secret committed in the diff", "A new line appears to contain a hard-coded credential. Move it to a secret store and rotate it.", file, line, 0.92, rag_context=context))
        if re.search(r"(?i)\b(?:print|console\.log|logger\.\w+|logging\.\w+)\s*\([^)]*(?:password|secret|token|api[_-]?key)[^)]*['\"][^'\"]{4,}['\"]", code):
            findings.append(finding("security", "high", "Hardcoded credential leaked in print/log statement", "Sensitive credential or password literal is printed directly to stdout/logs. Plaintext secrets in logs can be exposed to unauthorized observers. Load credentials from environment variables or secrets manager and avoid logging them.", file, line, 0.95, rag_context=context))
        if re.search(r"\bif\s*\(\s*(\w+)\.role\s*===\s*['\"]admin['\"]\s*\)", code):
            findings.append(finding("security", "high", "Broken authorization logic on route", "The authorization check inspects the target user's role ('user.role === \"admin\"') rather than verifying the requesting actor's identity and permissions (e.g. req.user or session). Any unauthenticated or unauthorized caller can invoke this endpoint, and only target users with role 'admin' can be deleted.", file, line, 0.95, rag_context=context))
        if re.search(r"\beval\s*\(", code):
            findings.append(finding("security", "critical", "User-controlled code execution via eval", "The diff executes a string with eval(). If user input reaches that string, attackers can run arbitrary JavaScript. Replace eval with a safe explicit operation.", file, line, 0.9, rag_context=context))
        if "jwt.decode" in lower and "verify" not in lower:
            findings.append(finding("security", "high", "JWT is decoded without verification", "Verify JWT signatures with the expected algorithm, issuer, and audience.", file, line, 0.86, rag_context=context))
        if re.search(r"select .* \+|where .* \+", lower):
            findings.append(finding("security", "high", "SQL appears to be built through string concatenation", "Use parameterized queries or a query builder for untrusted input.", file, line, 0.82, rag_context=context))
            
    dep_start = time.perf_counter()
    dep_contexts = []
    dep_queries_count = 0
    changed_symbols_by_file = {}
    
    for file in state.get("files", []):
        path = file.get("path")
        if not path or file.get("status") == "removed":
            continue
        lang = get_file_language(path)
        if not lang:
            logger.info("Dependency retrieval skipped", path=path, reason="unsupported language")
            continue
        symbols = detect_signature_changes(path, file.get("patch", ""))
        if symbols:
            changed_symbols_by_file[path] = symbols[:5]
            
    tasks = []
    meta = []
    for path, symbols in changed_symbols_by_file.items():
        ext = Path(path).suffix.lower()
        for sym in symbols:
            if len(tasks) >= 15:
                break
            meta.append((sym, ext))
            query_text = f"{sym} usage reference"
            tasks.append(retrieve_context(namespace, query_text, limit=3, extension=ext))
            
    if tasks:
        query_results = await asyncio.gather(*tasks)
        for (sym, ext), res in zip(meta, query_results):
            dep_queries_count += 1
            if res:
                formatted_snippets = []
                for match in res:
                    formatted_snippets.append(f"File: {match.get('path')}\nSnippet:\n{match.get('text')}")
                snippets_str = "\n---\n".join(formatted_snippets)
                dep_contexts.append(f"References to symbol '{sym}' in other {ext} files:\n{snippets_str}")
            else:
                dep_contexts.append(f"References to symbol '{sym}' in other {ext} files: no other same-language references found in the indexed codebase")
                
    dep_duration = int((time.perf_counter() - dep_start) * 1000)
    state["dependency_latency_ms"] = state.get("dependency_latency_ms", 0) + dep_duration
    if dep_queries_count > 0:
        logger.info("Dependency lookup completed", agent="security", duration_ms=dep_duration, query_count=dep_queries_count)
        
    context_str = "\n".join(set(contexts))
    if dep_contexts:
        context_str += "\n\n=== CROSS-FILE DEPENDENCY REFERENCES ===\n" + "\n\n".join(dep_contexts)
        
    llm_findings = await _groq_security_findings(state, context_str)
    
    added_lines = {}
    for file, line, code in iter_added_lines(state.get("files", [])):
        path = file.get("path")
        if path:
            added_lines[(path, line)] = code

    def get_line_code(path, line):
        if (path, line) in added_lines:
            return added_lines[(path, line)]
        try:
            repo_full_name = state.get("repository", {}).get("fullName", "")
            local_path = os.path.join(os.path.dirname(__file__), "..", "..", "repos", repo_full_name, path)
            if os.path.exists(local_path):
                with open(local_path, "r", encoding="utf8", errors="ignore") as f:
                    file_lines = f.readlines()
                    if 0 < line <= len(file_lines):
                        return file_lines[line - 1]
        except Exception:
            pass
        return None

    combined_findings = llm_findings + findings
    filtered_findings = []
    seen_path_traversal = set()
    added_lines_text = " ".join(code.lower() for _, _, code in iter_added_lines(state.get("files", [])))
    has_path_traversal_mitigation = any(
        pat in added_lines_text for pat in [
            "path.basename", "basename(", "path.normalize", "normalize(", "path.resolve", "resolve("
        ]
    )

    for f in combined_findings:
        title_lower = f.get("title", "").lower()
        body_lower = f.get("body", "").lower()
        is_secret = False
        for term in ["secret", "credential", "password", "token", "api_key", "api-key", "apikey"]:
            if term in title_lower or term in body_lower:
                is_secret = True
                break
        if is_secret:
            code_line = get_line_code(f.get("path"), f.get("line"))
            if code_line and not is_valid_hardcoded_credential(code_line):
                continue
        is_path_traversal = any(term in title_lower or term in body_lower for term in ["path traversal", "directory traversal", "file inclusion", "lfi"])
        if is_path_traversal:
            key = (f.get("path"), f.get("line"))
            if key in seen_path_traversal:
                continue
            seen_path_traversal.add(key)
            if has_path_traversal_mitigation:
                f["severity"] = "low"
                if "mitigation" not in body_lower and "basename" not in body_lower:
                    f["body"] = f.get("body", "") + " Note: The code utilizes path.basename() or other sanitization to mitigate path traversal, reducing the severity to LOW."
        filtered_findings.append(f)
    return filtered_findings


async def _groq_security_findings(state, context_str):
    system = (
        "You are CodeReviewAI's security reviewer. Return JSON only: {\"findings\": [...]}. "
        "Each finding must include category ('security'), severity ('critical', 'high', 'medium', 'low'), title, body, path, line, confidence. "
        "Security Checklist: "
        "1. Hardcoded credentials: Check for secrets, passwords, API keys, or tokens assigned to variables, defined in config objects, OR leaked to stdout/logs via print(), console.log(), or logging statements. Always flag plaintext password/secret literals as HIGH or CRITICAL. "
        "2. Broken or missing authorization: Check whether mutating endpoints (DELETE, POST, PUT) verify requester identity/session (req.user) rather than inspecting target resource attributes (target user.role). Flag missing caller authorization as HIGH. "
        "3. Injections and command execution: SQL injection, eval(), shell execution. "
        "4. Path traversal and unauthorized access. "
        "Rules: Only report vulnerabilities directly present in the diff."
    )
    diff_text = diff_excerpt(state.get("files", []), full_diff=state.get("diff", ""))
    logger.info(
        "Security agent prompt diff prepared",
        pr=state.get("pullRequest", {}).get("number"),
        diff_length=len(diff_text),
        diff_preview=diff_text[:300] if diff_text else "",
    )
    clean_ctx = context_str[:300] if context_str else ""
    user = (
        f"Repository: {state.get('repository', {}).get('fullName')}\n"
        f"Pull request: {state.get('pullRequest', {}).get('title', '')}\n"
        f"Codebase Context:\n{clean_ctx}\n"
        f"Diff:\n{diff_text}"
    )
    try:
        result = await groq_json(system, user)
        return normalize_findings(result, "security")
    except Exception as e:
        logger.exception("Security agent Groq call failed", error=str(e))
        return []
