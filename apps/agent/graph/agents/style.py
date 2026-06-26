import asyncio
import re

from graph.agents.common import finding, iter_added_lines
from llm.groq import diff_excerpt, groq_json, normalize_findings
from rag import retrieve_context


async def style_agent(state):
    findings = []
    contexts = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    last_added_return_by_path = {}
    declared_by_path = collect_declared_identifiers(state.get("files", []))
    
    unique_files = {file.get("path") for file in state.get("files", []) if file.get("path") and file.get("status") != "removed"}
    file_contexts = {}
    
    async def fetch_file_context(path):
        try:
            return path, await retrieve_context(namespace, f"{path} style standards")
        except Exception:
            return path, []
            
    results = await asyncio.gather(*(fetch_file_context(path) for path in unique_files))
    for path, ctx in results:
        file_contexts[path] = ctx
        contexts.extend([c.get("text") for c in ctx if c.get("text")])
        
    for file, line, code in iter_added_lines(state.get("files", [])):
        path = file.get("path")
        context = file_contexts.get(path, [])
        lower = code.lower()
        is_js = is_javascript_path(path)
        
        if len(code) > 140:
            findings.append(finding("style", "low", "Line is difficult to scan", "Break the expression into named parts.", file, line, 0.7, rag_context=context))
        if re.search(r"\b(temp|foo|bar|asdf)\b", code):
            findings.append(finding("style", "low", "Placeholder naming introduced", "Use a name that reflects the domain role of the value.", file, line, 0.64, rag_context=context))
        if is_js and re.search(r"[^=!]==[^=]", code):
            findings.append(finding("style", "medium", "Loose equality used in JavaScript", "Use strict equality so JavaScript does not coerce values during authentication or control-flow checks.", file, line, 0.82, rag_context=context))
        assignment_match = re.search(r"^\s*([A-Za-z_$][\w$]*)\s*=", code)
        if is_js and assignment_match and not re.search(r"^\s*(const|let|var)\s+", code) and assignment_match.group(1) not in declared_by_path.get(path, set()):
            findings.append(finding("style", "high", "Implicit global assignment", "This assignment has no const, let, or var declaration, so it can create or overwrite a global variable. Declare the variable explicitly.", file, line, 0.84, rag_context=context))
        if is_js and re.search(r"\bnew\s+Buffer\s*\(", code):
            findings.append(finding("style", "medium", "Deprecated Buffer constructor", "The bare Buffer constructor is deprecated and can be unsafe. Use Buffer.from() or Buffer.alloc() instead.", file, line, 0.86, rag_context=context))
        if is_js and re.search(r"console\.log\s*\(", code) and last_added_return_by_path.get(path):
            findings.append(finding("style", "medium", "Unreachable code after return", "This statement appears immediately after a return in the same added block, so it will never execute. Remove it or move it before the return.", file, line, 0.8, rag_context=context))
        last_added_return_by_path[path] = lower.strip().startswith("return ")
            
    context_str = "\n".join(set(contexts))
    llm_findings = await _groq_style_findings(state, context_str)
    return llm_findings + findings


async def _groq_style_findings(state, context_str):
    system = (
        "You are CodeReviewAI's style and maintainability reviewer. Return JSON only with a findings array. "
        "Each finding must include category, severity, title, body, path, line, confidence. "
        "Focus on readability, naming, maintainability, testability, and consistency with surrounding patterns. "
        "Enumerate every distinct concrete issue in the diff. Do not stop after one issue per file, and do not collapse unrelated style, maintainability, or JavaScript API issues into one finding. "
        "Strict Precision Rules: "
        "1. Do NOT emit a finding if your analysis concludes the issue does not apply, is not present, or is not applicable. Only emit findings for issues actually identified in the code. "
        "2. Do NOT emit hypothetical or generic findings unless you have concrete justification grounded in the actual code/diff showing a real, material risk. "
        "3. Do NOT double-count issues already flagged or primarily belonging to other categories (like performance or security). For example, do not flag a linear search as maintainability if it is already flagged as a performance issue."
    )
    user = (
        f"Repository: {state.get('repository', {}).get('fullName')}\n"
        f"Pull request: {state.get('pullRequest', {}).get('title', '')}\n"
        f"Codebase Context:\n{context_str}\n"
        f"Diff:\n{diff_excerpt(state.get('files', []))}"
    )
    try:
        result = await groq_json(system, user)
        return normalize_findings(result, "style")
    except Exception:
        return []


def collect_declared_identifiers(files):
    declared = {}
    for file in files:
        path = file.get("path")
        names = declared.setdefault(path, set())
        for _, _, code in iter_added_lines([file]):
            for match in re.finditer(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)", code):
                names.add(match.group(1))
            for match in re.finditer(r"\bfunction\s+([A-Za-z_$][\w$]*)", code):
                names.add(match.group(1))
            params = re.search(r"\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)", code)
            if params:
                for name in params.group(1).split(","):
                    clean = name.strip()
                    if re.match(r"^[A-Za-z_$][\w$]*$", clean):
                        names.add(clean)
    return declared


def is_javascript_path(path):
    return str(path or "").lower().endswith((".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"))
