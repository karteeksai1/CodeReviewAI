import asyncio
import re
import time
from pathlib import Path
import structlog

from graph.agents.common import finding, iter_added_lines
from llm.groq import diff_excerpt, groq_json, normalize_findings
from rag import retrieve_context, get_file_language, detect_signature_changes

logger = structlog.get_logger()


async def performance_agent(state):
    findings = []
    contexts = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    loop_indent_by_path = {}
    
    unique_files = {file.get("path") for file in state.get("files", []) if file.get("path") and file.get("status") != "removed"}
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
        indent = len(code) - len(code.lstrip())
        loop_indent = loop_indent_by_path.get(path)
        if loop_indent is not None and indent <= loop_indent:
            loop_indent_by_path[path] = None
            loop_indent = None
        if re.search(r"\b(for|while)\b", lower):
            loop_indent_by_path[path] = indent
            loop_indent = indent
        if loop_indent is not None and ("await " in lower or ".query(" in lower or ".find(" in lower):
            if not re.search(r"\b(for|while)\b", lower):
                findings.append(finding("performance", "medium", "Possible N+1 work inside a loop", "Batch, preload, or move async/database work outside the loop.", file, line, 0.78, rag_context=context))
        if "select *" in lower:
            findings.append(finding("performance", "low", "Unbounded column selection", "Prefer explicit columns for hot paths.", file, line, 0.66, rag_context=context))
            
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
        logger.info("Dependency lookup completed", agent="performance", duration_ms=dep_duration, query_count=dep_queries_count)
        
    context_str = "\n".join(set(contexts))
    if dep_contexts:
        context_str += "\n\n=== CROSS-FILE DEPENDENCY REFERENCES ===\n" + "\n\n".join(dep_contexts)
        
    llm_findings = await _groq_performance_findings(state, context_str)
    return llm_findings + findings


async def _groq_performance_findings(state, context_str):
    system = (
        "You are CodeReviewAI's performance reviewer. Return JSON only with a findings array. "
        "Each finding must include category, severity, title, body, path, line, confidence. "
        "Focus on N+1 queries, unbounded work, avoidable network calls, memory growth, and concurrency problems. "
        "Strict Precision Rules: "
        "1. Do NOT emit a finding if your analysis concludes the issue does not apply, is not present, or is not applicable (e.g. do not flag 'Avoidable Network Calls' if there are no network calls in the code). Only emit findings for issues actually identified in the code. "
        "2. Do NOT emit hypothetical, generic, or speculative findings (e.g. 'code is not thread-safe' or 'stores data in memory') unless you have concrete justification grounded in the actual code/diff showing a real, material risk. flag thread-safety only if there is evidence of concurrent/multi-threaded usage, and flag memory growth only if the dataset grows unbounded. "
        "3. Do NOT double-count issues already flagged or primarily belonging to other categories (like security or style/maintainability). "
        "4. Report only performance or concurrency issues directly evidenced by changed or immediately impacted lines in the diff. Do NOT infer issues about the broader codebase, runtime environment, or multi-threading model without explicit evidence in the diff. For example, JavaScript has a single-threaded runtime model; do not flag a plain class/object for concurrency or thread-safety issues without explicit evidence of concurrent workers, threads, SharedArrayBuffer, or concurrent access patterns in the diff itself."
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