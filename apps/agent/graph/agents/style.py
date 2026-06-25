import asyncio
import re

from graph.agents.common import finding, iter_added_lines
from llm.groq import diff_excerpt, groq_json, normalize_findings
from rag.retriever import retrieve_context


async def style_agent(state):
    findings = []
    contexts = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    
    unique_files = {file.get("path") for file in state.get("files", []) if file.get("path")}
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
        
        if len(code) > 140:
            findings.append(finding("style", "low", "Line is difficult to scan", "Break the expression into named parts.", file, line, 0.7, rag_context=context))
        if re.search(r"\b(temp|foo|bar|asdf)\b", code):
            findings.append(finding("style", "low", "Placeholder naming introduced", "Use a name that reflects the domain role of the value.", file, line, 0.64, rag_context=context))
            
    context_str = "\n".join(set(contexts))
    llm_findings = await _groq_style_findings(state, context_str)
    return llm_findings + findings


async def _groq_style_findings(state, context_str):
    system = (
        "You are CodeReviewAI's style and maintainability reviewer. Return JSON only with a findings array. "
        "Each finding must include category, severity, title, body, path, line, confidence. "
        "Focus on readability, naming, maintainability, testability, and consistency with surrounding patterns. "
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