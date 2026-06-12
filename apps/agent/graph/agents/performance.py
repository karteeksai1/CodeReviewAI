import re

from graph.agents.common import finding, iter_added_lines
from llm.groq import diff_excerpt, groq_json, normalize_findings
from rag.retriever import retrieve_context


async def performance_agent(state):
    findings = []
    contexts = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    in_loop = False
    
    for file, line, code in iter_added_lines(state.get("files", [])):
        lower = code.strip().lower()
        context = await retrieve_context(namespace, f"{file.get('path')} performance query loop")
        contexts.extend([c.get("text") for c in context if c.get("text")])
        
        if re.match(r"(for|while)\b", lower):
            in_loop = True
        if in_loop and ("await " in lower or ".query(" in lower or ".find(" in lower):
            findings.append(finding("performance", "medium", "Possible N+1 work inside a loop", "Batch, preload, or move async/database work outside the loop.", file, line, 0.78, rag_context=context))
        if "select *" in lower:
            findings.append(finding("performance", "low", "Unbounded column selection", "Prefer explicit columns for hot paths.", file, line, 0.66, rag_context=context))
            
    context_str = "\n".join(set(contexts))
    llm_findings = await _groq_performance_findings(state, context_str)
    return llm_findings + findings


async def _groq_performance_findings(state, context_str):
    system = (
        "You are CodeReviewAI's performance reviewer. Return JSON only with a findings array. "
        "Each finding must include category, severity, title, body, path, line, confidence. "
        "Focus on N+1 queries, unbounded work, avoidable network calls, memory growth, and concurrency problems."
    )
    user = (
        f"Repository: {state.get('repository', {}).get('fullName')}\n"
        f"Pull request: {state.get('pullRequest', {}).get('title', '')}\n"
        f"Codebase Context:\n{context_str}\n"
        f"Diff:\n{diff_excerpt(state.get('files', []))}"
    )
    try:
        result = await groq_json(system, user)
        return normalize_findings(result, "performance")
    except Exception:
        return []