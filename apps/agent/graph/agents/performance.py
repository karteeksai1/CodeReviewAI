import re

from graph.agents.common import finding, iter_added_lines
from rag.retriever import retrieve_context


async def performance_agent(state):
    findings = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    in_loop = False
    for file, line, code in iter_added_lines(state.get("files", [])):
        lower = code.strip().lower()
        context = await retrieve_context(namespace, f"{file.get('path')} performance query loop")
        if re.match(r"(for|while)\b", lower):
            in_loop = True
        if in_loop and ("await " in lower or ".query(" in lower or ".find(" in lower):
            findings.append(finding("performance", "medium", "Possible N+1 work inside a loop", "Batch, preload, or move async/database work outside the loop.", file, line, 0.78, rag_context=context))
        if "select *" in lower:
            findings.append(finding("performance", "low", "Unbounded column selection", "Prefer explicit columns for hot paths.", file, line, 0.66, rag_context=context))
    return findings
