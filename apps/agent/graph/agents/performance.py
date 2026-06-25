import asyncio
import re

from graph.agents.common import finding, iter_added_lines
from llm.groq import diff_excerpt, groq_json, normalize_findings
from rag import retrieve_context


async def performance_agent(state):
    findings = []
    contexts = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    in_loop = False
    
    unique_files = {file.get("path") for file in state.get("files", []) if file.get("path")}
    file_contexts = {}
    
    async def fetch_file_context(path):
        try:
            return path, await retrieve_context(namespace, f"{path} performance query loop")
        except Exception:
            return path, []
            
    results = await asyncio.gather(*(fetch_file_context(path) for path in unique_files))
    for path, ctx in results:
        file_contexts[path] = ctx
        contexts.extend([c.get("text") for c in ctx if c.get("text")])
        
    for file, line, code in iter_added_lines(state.get("files", [])):
        lower = code.strip().lower()
        path = file.get("path")
        context = file_contexts.get(path, [])
        
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
        "Focus on N+1 queries, unbounded work, avoidable network calls, memory growth, and concurrency problems. "
        "Strict Precision Rules: "
        "1. Do NOT emit a finding if your analysis concludes the issue does not apply, is not present, or is not applicable (e.g. do not flag 'Avoidable Network Calls' if there are no network calls in the code). Only emit findings for issues actually identified in the code. "
        "2. Do NOT emit hypothetical or generic findings (e.g. 'code is not thread-safe' or 'stores data in memory') unless you have concrete justification grounded in the actual code/diff showing a real, material risk. flag thread-safety only if there is evidence of concurrent/multi-threaded usage, and flag memory growth only if the dataset grows unbounded. "
        "3. Do NOT double-count issues already flagged or primarily belonging to other categories (like security or style/maintainability). Focus strictly on performance-relevant aspects."
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