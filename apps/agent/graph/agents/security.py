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
    if '=' not in code_clean and ':' not in code_clean:
        return False
    parts = re.split(r'[=:]', code_clean, maxsplit=1)
    lhs = parts[0].strip()
    rhs = parts[1].strip().rstrip(';,')
    keywords = ['password', 'key', 'secret', 'token', 'credential', 'api']
    lhs_lower = lhs.lower()
    if not any(kw in lhs_lower for kw in keywords):
        return False
    if 'process.env' in rhs.lower():
        return False
    if (rhs.startswith("'") and rhs.endswith("'")) or \
       (rhs.startswith('"') and rhs.endswith('"')) or \
       (rhs.startswith('`') and rhs.endswith('`')):
        content = rhs[1:-1].strip()
        if len(content) > 0:
            return True
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
        "You are CodeReviewAI's security reviewer. Return JSON only with a findings array. "
        "Each finding must include category, severity, title, body, path, line, confidence. "
        "Focus on exploitable auth, injection, secret, permission, data exposure, and supply-chain risks. "
        "Enumerate every distinct concrete issue in the diff. Do not stop after the highest-severity issue, and do not collapse unrelated issues in the same file into one finding. "
        "Strict Precision Rules: "
        "1. Do NOT emit a finding if your analysis concludes the issue does not apply, is not present, or is not applicable. Only emit findings for issues actually identified in the code. "
        "2. Do NOT emit hypothetical, generic, or speculative findings (e.g. 'code is not thread-safe' or 'lacks tests') unless you have concrete justification grounded in the actual code/diff showing a real, material risk. "
        "3. Do NOT double-count issues already flagged or primarily belonging to other categories (like performance or style). "
        "4. Report only issues directly evidenced by changed or immediately impacted lines in the diff. Do NOT infer or speculate about broader codebase issues, lack of tests, runtime environment, or multi-threading models without explicit evidence in the diff. For example, do not emit findings complaining about lack of test coverage for a class unless the diff explicitly shows test files being deleted or code added without required tests. "
        "5. Only flag a hardcoded credential finding when a variable name suggests a secret AND the right-hand side is a string literal (quoted value) — not a function call, not a variable reference, not process.env.*. "
        "6. Before assigning HIGH or CRITICAL severity to any security finding, check whether the diff itself contains mitigating controls (input validation, sanitization, bounds checking, authentication guards) that reduce the real-world exploitability. For example, if a path traversal pattern is detected but path.basename(), path.normalize() + bounds check, or path.resolve() + startsWith(baseDir) is also present in the same code path, downgrade severity to LOW and note the mitigation in the finding description, rather than describing it as an unmitigated vulnerability."
    )
    user = (
        f"Repository: {state.get('repository', {}).get('fullName')}\n"
        f"Pull request: {state.get('pullRequest', {}).get('title', '')}\n"
        f"Codebase Context:\n{context_str}\n"
        f"Diff:\n{diff_excerpt(state.get('files', []))}"
    )
    try:
        result = await groq_json(system, user)
        return normalize_findings(result, "security")
    except Exception:
        return []
