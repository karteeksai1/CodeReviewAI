import re

from graph.agents.common import finding, iter_added_lines
from rag.retriever import retrieve_context

SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
    re.compile(r"ghp_[A-Za-z0-9_]{30,}"),
    re.compile(r"sk-[A-Za-z0-9]{32,}"),
]


async def security_agent(state):
    findings = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    for file, line, code in iter_added_lines(state.get("files", [])):
        lower = code.lower()
        context = await retrieve_context(namespace, f"{file.get('path')} security auth")
        if any(pattern.search(code) for pattern in SECRET_PATTERNS):
            findings.append(finding("security", "critical", "Potential secret committed in the diff", "A new line appears to contain a hard-coded credential. Move it to a secret store and rotate it.", file, line, 0.92, rag_context=context))
        if "jwt.decode" in lower and "verify" not in lower:
            findings.append(finding("security", "high", "JWT is decoded without verification", "Verify JWT signatures with the expected algorithm, issuer, and audience.", file, line, 0.86, rag_context=context))
        if re.search(r"select .* \+|where .* \+", lower):
            findings.append(finding("security", "high", "SQL appears to be built through string concatenation", "Use parameterized queries or a query builder for untrusted input.", file, line, 0.82, rag_context=context))
    return findings
