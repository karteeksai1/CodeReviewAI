import re

from graph.agents.common import finding, iter_added_lines
from rag.retriever import retrieve_context


async def style_agent(state):
    findings = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    for file, line, code in iter_added_lines(state.get("files", [])):
        context = await retrieve_context(namespace, f"{file.get('path')} style standards")
        if len(code) > 140:
            findings.append(finding("style", "low", "Line is difficult to scan", "Break the expression into named parts.", file, line, 0.7, rag_context=context))
        if re.search(r"\b(temp|foo|bar|asdf)\b", code):
            findings.append(finding("style", "low", "Placeholder naming introduced", "Use a name that reflects the domain role of the value.", file, line, 0.64, rag_context=context))
    return findings
