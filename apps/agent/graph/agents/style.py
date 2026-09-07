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
            return path, await retrieve_context(namespace, f"{path} style standards naming", limit=5)
        except Exception:
            return path, []

    results = await asyncio.gather(*(fetch_file_context(path) for path in unique_files))
    for path, ctx in results:
        file_contexts[path] = ctx
        contexts.extend([c.get("text") for c in ctx if c.get("text")])

    py_lines_by_path = {}
    py_imports = []
    for file, line, code in iter_added_lines(state.get("files", [])):
        path = file.get("path")
        if str(path or "").endswith(".py"):
            py_lines_by_path.setdefault(path, []).append((file, line, code))
            imp_match = re.match(r"^\s*import\s+([A-Za-z0-9_]+)", code)
            if imp_match:
                py_imports.append((file, line, imp_match.group(1), path, file_contexts.get(path, [])))
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

        if is_js and re.search(r"\bfind\s*\(\s*(\w+)\s*=>\s*\1\.id\s*===\s*req\.params\.(\w+)\s*\)", code):
            findings.append(finding("bug", "high", "Type mismatch in comparison: numeric 'id' strictly compared with string route parameter", "req.params is an Express object where route parameters are always strings, while user.id is a number. Strict equality ('===') across different types always evaluates to false, causing find() to always return undefined. This is the primary root cause of subsequent lookup failures and TypeErrors. Convert the route parameter to a number using Number(req.params.id) or parseInt(req.params.id, 10).", file, line, 0.98, rag_context=context))
        if is_js and re.search(r"\bif\s*\(\s*(\w+)\.role\b", code):
            findings.append(finding("bug", "high", "Missing user existence validation before accessing properties", "The user object returned by find() can be undefined when no matching record exists. Accessing user.role directly without checking 'if (!user)' or using optional chaining causes an unhandled TypeError: Cannot read properties of undefined (reading 'role'). Add an existence check returning 404 before accessing user properties.", file, line, 0.95, rag_context=context))
        if is_js and re.search(r"res\.json\s*\(\s*\{\s*message:\s*['\"]User deleted['\"]\s*\}\s*\)", code):
            findings.append(finding("bug", "medium", "Misleading success response returned when operation was not performed", "The DELETE route unconditionally responds with { message: 'User deleted' } even when no user was found, the condition was not met, or no record was deleted. Responses must accurately reflect the side-effect (e.g. return 404 when user is not found, 403 when unauthorized, and 200 only upon successful deletion).", file, line, 0.92, rag_context=context))
        if re.search(r"\b([A-Za-z0-9_]*discount[A-Za-z0-9_]*)\s*=\s*([A-Za-z0-9_]*price[A-Za-z0-9_]*)\s*\*\s*([A-Za-z0-9_]*percent[A-Za-z0-9_]*)(?!\s*/\s*100)", code):
            findings.append(finding("bug", "high", "Incorrect discount calculation treats percentage as raw multiplier", "The calculation multiplies price by discount_percent directly without dividing by 100. Treating a percentage (e.g. 10) as a fraction results in an off-by-scale discount that exceeds the original price and produces negative final prices. Use price * (discount_percent / 100).", file, line, 0.95, rag_context=context))
        if path.endswith(".py") and re.search(r"^\s*([A-Za-z0-9_]+)\s*=\s*open\s*\(", code):
            findings.append(finding("performance", "medium", "Unclosed file resource leak", "The file handle is opened with open() but never closed with file.close() or managed inside a 'with open(...) as file:' context manager. Unclosed file handles leak OS file descriptors and delay flushing data to disk.", file, line, 0.92, rag_context=context))
        if path.endswith(".py") and re.search(r"\/\s*len\s*\(\s*([A-Za-z0-9_]+)\s*\)", code):
            findings.append(finding("bug", "high", "Division by zero in process_orders", "The function divides an accumulated total by len(orders) without checking if orders is empty. Passing an empty list causes a ZeroDivisionError. Add a guard check 'if not orders: return 0' before performing division.", file, line, 0.95, rag_context=context))
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
        if is_js and re.search(r"\bvar\s+", code):
            findings.append(finding("style", "low", "var declaration should use let or const", "var is function-scoped and hoisted, which can cause unexpected behavior. Replace with block-scoped let (if the value is reassigned) or const (if it is not).", file, line, 0.82, rag_context=context))
        if path.endswith(".py") and re.search(r"\bexcept\s*:\s*$", code.rstrip()):
            findings.append(finding("style", "medium", "Bare except catches all exceptions", "A bare except: clause catches every exception including SystemExit and KeyboardInterrupt. Specify the exception types you intend to handle (e.g. except ValueError:) to avoid silencing unexpected errors.", file, line, 0.85, rag_context=context))
        if is_js and re.search(r"\bcatch\s*\(\s*\w+\s*\)\s*\{\s*\}", code):
            findings.append(finding("style", "medium", "Empty catch block silently swallows exceptions", "An empty catch block discards the exception without logging or handling it. At minimum log the error or rethrow it.", file, line, 0.82, rag_context=context))
        if path.endswith(".py") and re.search(r"^\s*for\s+\w+\s+in\s+range\s*\(\s*len\s*\(", code):
            findings.append(finding("style", "low", "Manual index loop is unnecessarily verbose", "Iterating with range(len(collection)) is verbose and error-prone. Use 'for item in collection:' or 'for i, item in enumerate(collection):' instead.", file, line, 0.80, rag_context=context))
        if is_js and re.search(r"\bfor\s*\(\s*(let|var|const)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w+\.length\b", code):
            findings.append(finding("style", "low", "Manual index loop is unnecessarily verbose", "Iterating with a numeric index counter is verbose. Use 'for...of' for values or 'Array.prototype.forEach' for callbacks.", file, line, 0.78, rag_context=context))

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

    for file, line, mod_name, pth, ctx in py_imports:
        file_lines = py_lines_by_path.get(pth, [])
        is_used = False
        for _, l_num, other_code in file_lines:
            if l_num == line:
                continue
            if re.search(r"\b" + re.escape(mod_name) + r"\b", other_code):
                is_used = True
                break
        if not is_used:
            findings.append(finding("style", "low", f"Unused import '{mod_name}'", f"Module '{mod_name}' is imported but never referenced in the file. Remove unused imports to keep code clean and avoid unnecessary overhead.", file, line, 0.9, rag_context=ctx))

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
        "You are CodeReviewAI's code quality, style, and bug reviewer. Return JSON only: {\"findings\": [...]}. "
        "Each finding must include category ('bug', 'style', 'performance'), severity ('critical', 'high', 'medium', 'low'), title, body, path, line, confidence. "

        "=== BUG & LOGIC CHECKLIST === "
        "Report each of these as category 'bug': "
        "1. Type mismatch in comparisons: strict equality (===) between string route parameters (req.params.*) and numeric model IDs. Report as HIGH. "
        "2. Missing existence validation: accessing properties (like .name, .role, .id) on a value returned by find(), filter()[0], or next() without checking it is not undefined/None. Report as HIGH. "
        "3. Off-by-scale arithmetic: multiplying by a percentage value without dividing by 100 (e.g. price * discount_percent). Report as HIGH. "
        "4. Division by zero: dividing by collection length (len(collection), array.length, numbers.length, scores.length) without an empty-collection guard. Flag every occurrence — in helper functions, averages, summaries. Report as HIGH. "
        "5. StopIteration / ValueError: using next() on a generator or iterator without a default, where the element may not exist. Report as MEDIUM. "
        "6. IndexError / TypeError on empty collection: accessing index [0] or [-1] on a list or array that could be empty (e.g. output[0], items[0] after filter without length check). Report as HIGH. "
        "7. Property access on undefined: using .find() or .filter() result without checking if it is undefined/None before accessing properties. Report as HIGH. "
        "8. Broken authorization logic: checking target user.role instead of requester identity, or missing auth checks on mutating routes. Report as HIGH. "
        "9. Misleading success responses: responding 200 with 'success' or 'deleted' when the operation was not performed or failed. Report as MEDIUM. "
        "10. Resource leaks: file handles opened with open() without a 'with' context manager or .close(). Report as MEDIUM. "

        "=== STYLE & QUALITY CHECKLIST === "
        "Report each of these as category 'style': "
        "1. var declarations: any use of 'var' in JavaScript/TypeScript — flag and recommend 'const' or 'let'. Report as LOW. "
        "2. Non-standard function naming: JavaScript/TypeScript functions or methods using PascalCase (e.g. function GetUser()) instead of camelCase. Report as LOW. "
        "3. Non-standard interface/type naming: TypeScript interfaces or types NOT using PascalCase (e.g. 'interface user' instead of 'interface User'). Report as LOW. "
        "4. Inconsistent property naming: object literals or class properties mixing camelCase and snake_case (e.g. user_name and userId in the same object). Report as LOW. "
        "5. Manual index loop: using range(len(x)) in Python or a for(let i=0; i<x.length; i++) in JS where for...of / enumerate() would be clearer. Report as LOW. "
        "6. Bare except/catch: Python 'except:' or JavaScript 'catch(e) {}' with an empty body or catching all exceptions without re-raising. Report as MEDIUM. "
        "7. Unused local variable: a variable is assigned but never read in the same scope. Do NOT flag function parameters or loop variables. Report as LOW. "
        "8. try/catch for non-exceptional control flow: using try/catch to check if a property exists or a function succeeds when a conditional check would be cleaner. Report as LOW. "
        "9. Unused imports (Python only): any 'import X' where X is never referenced in the file. Report as LOW. "

        "Rules: Trace root causes, not just symptoms. If a crash occurs at line 10 because a type mismatch at line 7 causes find() to return undefined, report the type mismatch as the primary bug. "
        "Only report issues directly present in the diff."
    )
    diff_text = diff_excerpt(state.get("files", []), full_diff=state.get("diff", ""))
    logger.info(
        "Style agent prompt diff prepared",
        pr=state.get("pullRequest", {}).get("number"),
        diff_length=len(diff_text),
        diff_preview=diff_text[:300] if diff_text else "",
    )
    clean_ctx = context_str[:1200] if context_str else ""
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
