import asyncio
import re

from graph.agents.common import finding, iter_added_lines
from llm.groq import diff_excerpt, groq_json, normalize_findings
from rag import retrieve_context

SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
    re.compile(r"ghp_[A-Za-z0-9_]{30,}"),
    re.compile(r"sk-[A-Za-z0-9]{32,}"),
]


async def security_agent(state):
    findings = []
    contexts = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    
    unique_files = {file.get("path") for file in state.get("files", []) if file.get("path")}
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
        if "jwt.decode" in lower and "verify" not in lower:
            findings.append(finding("security", "high", "JWT is decoded without verification", "Verify JWT signatures with the expected algorithm, issuer, and audience.", file, line, 0.86, rag_context=context))
        if re.search(r"select .* \+|where .* \+", lower):
            findings.append(finding("security", "high", "SQL appears to be built through string concatenation", "Use parameterized queries or a query builder for untrusted input.", file, line, 0.82, rag_context=context))
            
    context_str = "\n".join(set(contexts))
    llm_findings = await _groq_security_findings(state, context_str)
    return llm_findings + findings


async def _groq_security_findings(state, context_str):
    system = (
        "You are CodeReviewAI's security reviewer. Return JSON only with a findings array. "
        "Each finding must include category, severity, title, body, path, line, confidence. "
        "Focus on exploitable auth, injection, secret, permission, data exposure, and supply-chain risks. "
        "Strict Precision Rules: "
        "1. Do NOT emit a finding if your analysis concludes the issue does not apply, is not present, or is not applicable. Only emit findings for issues actually identified in the code. "
        "2. Do NOT emit hypothetical or generic findings (e.g. 'code is not thread-safe' or 'stores data in memory') unless you have concrete justification grounded in the actual code/diff showing a real, material risk. "
        "3. Do NOT double-count issues already flagged or primarily belonging to other categories (like performance or style). Focus strictly on security-relevant aspects."
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