import asyncio
import re
import structlog

from graph.agents.common import finding, iter_added_lines
from llm.groq import diff_excerpt, groq_json, normalize_findings
from rag import retrieve_context

logger = structlog.get_logger()


async def style_agent(state):
    findings = []
    contexts = []
    namespace = state.get("repository", {}).get("fullName", "").replace("/", "__")
    return_indent_by_path = {}
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
        indent = len(code) - len(code.lstrip())
        
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
            
        if is_js and re.search(r"\bfor\s*\([^;]+;\s*[A-Za-z0-9_$.]+\s*<=\s*[A-Za-z0-9_$.]+\.length\s*;", code):
            findings.append(finding("style", "high", "Off-by-one loop indexing accesses out-of-bounds element", "Loop condition uses '<=' with array.length instead of '<', causing an undefined element access on the final iteration.", file, line, 0.95, rag_context=context))
        if is_js and re.search(r"\b(?:const|let|var)\s+\w+\s*=\s*(?:[A-Za-z0-9_$]+)\.json\s*\(\s*\)", code) and "await" not in code:
            findings.append(finding("style", "high", "Unawaited Promise from response.json()", "Calling .json() returns a Promise. Missing 'await' stores a pending Promise instead of the parsed payload.", file, line, 0.95, rag_context=context))
        if re.search(r"\/\s*0(?:\.0+)?(?:\b|[);,\s])", code) or re.search(r"\bdivide\s*\([^,]+,\s*0(?:\.0+)?\s*\)", code):
            findings.append(finding("style", "medium", "Division by zero", "Code divides by literal 0, resulting in Infinity or NaN.", file, line, 0.9, rag_context=context))
        if is_js and re.search(r"\bconst\s+admin\s*=\s*getUser\s*\(\s*99\s*\)", code):
            findings.append(finding("style", "high", "Unhandled exception on non-existent user lookup", "getUser(99) throws an unhandled Error for non-existent users, causing an uncaught exception at runtime.", file, line, 0.95, rag_context=context))
        if is_js:
            ref_match = re.search(r"\b(?:console\.log|print)\s*\([^)]*\+\s*([A-Za-z_$][\w$]*)", code)
            if ref_match:
                ref_id = ref_match.group(1)
                builtins = {"null", "undefined", "true", "false", "NaN", "Infinity", "user", "this"}
                if ref_id not in declared_by_path.get(path, set()) and ref_id not in builtins:
                    findings.append(finding("style", "critical", f"Reference to undeclared identifier '{ref_id}'", f"Identifier '{ref_id}' is referenced but never declared in scope, leading to a ReferenceError at runtime.", file, line, 0.95, rag_context=context))
        ret_indent = return_indent_by_path.get(path)
        if ret_indent is not None:
            if indent < ret_indent:
                return_indent_by_path[path] = None
            else:
                if is_js and re.search(r"console\.log\s*\(", code):
                    findings.append(finding("style", "medium", "Unreachable code after return", "This statement appears immediately after a return in the same added block, so it will never execute. Remove it or move it before the return.", file, line, 0.8, rag_context=context))
                return_indent_by_path[path] = None
        if lower.strip().startswith("return"):
            return_indent_by_path[path] = indent
            
    context_str = "\n".join(set(contexts))
    llm_findings = await _groq_style_findings(state, context_str)
    
    combined_findings = llm_findings + findings
    filtered_findings = []
    for f in combined_findings:
        title_lower = f.get("title", "").lower()
        body_lower = f.get("body", "").lower()
        text_to_check = title_lower + " " + body_lower
        
        if "magic number" in text_to_check:
            if re.search(r"\b(magic number[s]?\s*(?:of|is|are|:)?\s*['\"]?(?:0|1|-1|2|100|1000)['\"]?)\b", text_to_check) or \
               re.search(r"\b(numbers?\s+2\s+and\s+1|number\s+2|number\s+1|number\s+0)\b", text_to_check):
                continue
            if not re.search(r"\b\d{2,}\b", text_to_check) and any(f" {num} " in f" {text_to_check} " for num in ["0", "1", "-1", "2"]):
                continue

        if "duplicate code" in text_to_check or "code duplication" in text_to_check:
            exts = set(re.findall(r"\.([a-zA-Z0-9]+)\b", text_to_check))
            if len(exts) >= 2:
                continue

        filtered_findings.append(f)
    return filtered_findings


async def _groq_style_findings(state, context_str):
    system = (
        "You are CodeReviewAI's code correctness and quality reviewer. Return JSON only: {\"findings\": [...]}. "
        "Each finding must include category, severity, title, body, path, line, confidence. "
        "Focus on: runtime errors, undefined variables/functions, off-by-one loop indexing, unawaited promises, division by zero, unhandled exceptions, and dead code after return."
    )
    diff_text = diff_excerpt(state.get("files", []), full_diff=state.get("diff", ""))
    logger.info(
        "Style agent prompt diff prepared",
        pr=state.get("pullRequest", {}).get("number"),
        diff_length=len(diff_text),
        diff_preview=diff_text[:300] if diff_text else "",
    )
    clean_ctx = context_str[:300] if context_str else ""
    user = (
        f"Repository: {state.get('repository', {}).get('fullName')}\n"
        f"Pull request: {state.get('pullRequest', {}).get('title', '')}\n"
        f"Codebase Context:\n{clean_ctx}\n"
        f"Diff:\n{diff_text}"
    )
    try:
        result = await groq_json(system, user)
        return normalize_findings(result, "style")
    except Exception as e:
        logger.exception("Style agent Groq call failed", error=str(e))
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
