import re

from graph.agents.common import finding, iter_added_lines
from llm.groq import diff_excerpt, groq_json, normalize_findings
from rag.retriever import retrieve_context


async def style_agent(state):
    findings = []
    llm_findings = await _groq_style_findings(state)
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    for file, line, code in iter_added_lines(state.get("files", [])):
        context = await retrieve_context(namespace, f"{file.get('path')} style standards")
        if len(code) > 140:
            findings.append(finding("style", "low", "Line is difficult to scan", "Break the expression into named parts.", file, line, 0.7, rag_context=context))
        if re.search(r"\b(temp|foo|bar|asdf)\b", code):
            findings.append(finding("style", "low", "Placeholder naming introduced", "Use a name that reflects the domain role of the value.", file, line, 0.64, rag_context=context))
    return llm_findings + findings


async def _groq_style_findings(state):
    system = (
        "You are CodeReviewAI's style and maintainability reviewer. Return JSON only with a findings array. "
        "Each finding must include category, severity, title, body, path, line, confidence. "
        "Focus on readability, naming, maintainability, testability, and consistency with surrounding patterns."
    )
    user = (
        f"Repository: {state.get('repository', {}).get('fullName')}\n"
        f"Pull request: {state.get('pullRequest', {}).get('title', '')}\n"
        f"Diff:\n{diff_excerpt(state.get('files', []))}"
    )
    try:
        result = await groq_json(system, user)
        return normalize_findings(result, "style")
    except Exception:
        return []
