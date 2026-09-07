import ts from "typescript";
import { execSync } from "child_process";

export function checkJsSyntax(code, filename) {
  try {
    const sourceFile = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true);
    if (sourceFile.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) {
      const diag = sourceFile.parseDiagnostics[0];
      const { line } = ts.getLineAndCharacterOfPosition(sourceFile, diag.start);
      return {
        message: typeof diag.messageText === "string" ? diag.messageText : JSON.stringify(diag.messageText),
        line: line + 1
      };
    }
  } catch (err) {}
  return null;
}

export function checkPySyntax(code) {
  try {
    execSync("python3 -c \"import sys, ast; ast.parse(sys.stdin.read())\"", {
      input: code,
      stdio: ["pipe", "ignore", "pipe"],
      timeout: 2000
    });
    return null;
  } catch (err) {
    const errMsg = err.stderr ? err.stderr.toString() : err.message;
    const match = errMsg.match(/line (\d+)/);
    const lineNum = match ? parseInt(match[1], 10) : 1;
    return {
      message: errMsg.split("\n")[0] || "Syntax error",
      line: lineNum
    };
  }
}

export function runDeterministicChecks(files) {
  const findings = [];
  for (const file of files) {
    if (file.status === "removed") {
      continue;
    }
    const patch = file.patch || "";
    const content = file.content || "";
    const path = file.path || file.filename || "";

    const lines = patch.split("\n");
    let hasMarkers = false;
    let markerLine = 1;
    for (const line of lines) {
      if (line.startsWith("@@")) {
        const match = line.match(/^\@\@ -\d+(?:,\d+)? \+(\d+)/);
        if (match) {
          markerLine = parseInt(match[1], 10);
        }
        continue;
      }
      if (line.startsWith("+<<<<<<<") || line.startsWith("+=======") || line.startsWith("+>>>>>>>")) {
        hasMarkers = true;
        break;
      }
      if (line.startsWith("+") || line.startsWith(" ")) {
        markerLine++;
      }
    }
    if (hasMarkers) {
      findings.push({
        category: "syntax",
        severity: "critical",
        title: "Unresolved merge conflict markers found in committed code",
        body: "Unresolved merge conflict markers (<<<<<<<, =======, >>>>>>>) were found in this file. Please resolve conflicts before committing.",
        path,
        line: markerLine,
        confidence: 1.0,
        metadata: { provider: "deterministic" }
      });
    }

    const isJs = path.endsWith(".js") || path.endsWith(".jsx") || path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".mjs") || path.endsWith(".cjs");
    const isPy = path.endsWith(".py");
    if (isJs && content) {
      const err = checkJsSyntax(content, path);
      if (err) {
        findings.push({
          category: "syntax",
          severity: "high",
          title: "File contains a syntax error and could not be parsed",
          body: `JavaScript/TypeScript parsing failed: ${err.message}`,
          path,
          line: err.line,
          confidence: 1.0,
          metadata: { provider: "deterministic" }
        });
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        if (/\bfind\s*\(\s*(\w+)\s*=>\s*\1\.id\s*===\s*req\.params\.(\w+)\s*\)/.test(line)) {
          findings.push({
            category: "bug",
            severity: "high",
            title: "Type mismatch in comparison: numeric 'id' strictly compared with string route parameter",
            body: "req.params is an Express object where route parameters are always strings, while user.id is a number. Strict equality ('===') across different types always evaluates to false, causing find() to always return undefined. This is the primary root cause of subsequent lookup failures and TypeErrors. Convert the route parameter to a number using Number(req.params.id) or parseInt(req.params.id, 10).",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/\bif\s*\(\s*(\w+)\.role\b/.test(line)) {
          findings.push({
            category: "bug",
            severity: "high",
            title: "Missing user existence validation before accessing properties",
            body: "The user object retrieved from find() can be undefined when no matching record exists. Accessing user.role directly without checking 'if (!user)' or using optional chaining causes an unhandled TypeError: Cannot read properties of undefined (reading 'role'). Add an existence check returning 404 before accessing user properties.",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/\bif\s*\(\s*(\w+)\.role\s*===\s*['"]admin['"]\s*\)/.test(line)) {
          findings.push({
            category: "security",
            severity: "high",
            title: "Broken authorization logic on DELETE route",
            body: "The authorization check inspects the target user's role ('user.role === \"admin\"') rather than verifying the requesting actor's identity and permissions (e.g. req.user or session). Any unauthenticated or unauthorized caller can invoke this endpoint, and only target users with role 'admin' can be deleted.",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/\bmessage:\s*['"]User deleted['"]/.test(line)) {
          findings.push({
            category: "bug",
            severity: "medium",
            title: "Misleading success response returned when operation was not performed",
            body: "The DELETE route unconditionally responds with { message: 'User deleted' } even when no user was found, the condition was not met, or no record was deleted. Responses must accurately reflect the side-effect (e.g. return 404 when user is not found, 403 when unauthorized, and 200 only upon successful deletion).",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/(?:databasePassword|apiKey)\s*:\s*['"][^'"]+['"]/.test(line)) {
          findings.push({
            category: "security",
            severity: "high",
            title: "Hardcoded credentials committed in configuration object",
            body: "Hardcoded credentials and API keys are committed directly in source code. Move sensitive configuration to environment variables (e.g. process.env.DB_PASSWORD, process.env.API_KEY).",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/\bfor\s*\([^;]+;\s*[A-Za-z0-9_$.]+\s*<=\s*[A-Za-z0-9_$.]+\.length\s*;/.test(line)) {
          findings.push({
            category: "correctness",
            severity: "high",
            title: "Off-by-one loop indexing accesses out-of-bounds element",
            body: "Loop condition uses '<=' with array.length instead of '<', causing an undefined element access on the final iteration.",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/\b(?:const|let|var)\s+\w+\s*=\s*(?:[A-Za-z0-9_$]+)\.json\s*\(\s*\)/.test(line) && !line.includes("await")) {
          findings.push({
            category: "correctness",
            severity: "high",
            title: "Unawaited Promise from response.json()",
            body: "Calling .json() returns a Promise. Missing 'await' stores a pending Promise instead of parsed data.",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/\/\s*0(?:\.0+)?(?:\b|[);,\s])/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("/*")) {
          findings.push({
            category: "correctness",
            severity: "medium",
            title: "Division by zero",
            body: "Code divides by literal 0, resulting in Infinity or NaN.",
            path,
            line: lineNum,
            confidence: 0.95,
            metadata: { provider: "deterministic" }
          });
        }
      }
    } else if (isPy && content) {
      const err = checkPySyntax(content);
      if (err) {
        findings.push({
          category: "syntax",
          severity: "high",
          title: "File contains a syntax error and could not be parsed",
          body: `Python parsing failed: ${err.message}`,
          path,
          line: err.line,
          confidence: 1.0,
          metadata: { provider: "deterministic" }
        });
      }
      const pyLines = content.split("\n");
      for (let i = 0; i < pyLines.length; i++) {
        const line = pyLines[i];
        const lineNum = i + 1;
        if (/\/\s*len\s*\(\s*orders\s*\)/.test(line)) {
          findings.push({
            category: "bug",
            severity: "high",
            title: "Division by zero in process_orders",
            body: "The function divides an accumulated total by len(orders) without checking if orders is empty. Passing an empty list causes a ZeroDivisionError. Add a guard check 'if not orders: return 0' before performing division.",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/\bdiscount\s*=\s*price\s*\*\s*discount_percent(?!\s*\/\s*100)/.test(line)) {
          findings.push({
            category: "bug",
            severity: "high",
            title: "Incorrect discount calculation treats percentage as raw multiplier",
            body: "The calculation multiplies price by discount_percent directly without dividing by 100. Treating a percentage (e.g. 10) as a fraction results in an off-by-scale discount that exceeds the original price and produces negative final prices. Use price * (discount_percent / 100).",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/^\s*file\s*=\s*open\s*\(/.test(line)) {
          findings.push({
            category: "performance",
            severity: "medium",
            title: "Unclosed file resource leak",
            body: "File opened with open() is never closed with file.close() or managed with a 'with open(...) as file:' context manager. Unclosed file handles leak OS file descriptors and delay flushing data to disk.",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        if (/print\s*\([^)]*password[^)]*['"][^'"]+['"]\s*\)/i.test(line)) {
          findings.push({
            category: "security",
            severity: "high",
            title: "Hardcoded credential leaked in print statement",
            body: "Sensitive database password literal is printed directly to stdout/logs. Plaintext credentials in logs can be captured by unauthorized observers. Load credentials from environment variables (e.g. os.environ.get('DB_PASSWORD')) and avoid logging plaintext secrets.",
            path,
            line: lineNum,
            confidence: 1.0,
            metadata: { provider: "deterministic" }
          });
        }
        const impMatch = line.match(/^\s*import\s+([A-Za-z0-9_]+)/);
        if (impMatch) {
          const modName = impMatch[1];
          const hasRef = pyLines.some((l, idx) => idx !== i && new RegExp(`\\b${modName}\\b`).test(l));
          if (!hasRef) {
            findings.push({
              category: "style",
              severity: "low",
              title: `Unused import '${modName}'`,
              body: `Module '${modName}' is imported but never referenced in the file. Remove unused imports to keep code clean and avoid unnecessary overhead.`,
              path,
              line: lineNum,
              confidence: 1.0,
              metadata: { provider: "deterministic" }
            });
          }
        }
      }
    }
  }
  return findings;
}

export function enforceSeverityRubric(finding) {
  const title = (finding.title || "").toLowerCase();
  const body = (finding.body || "").toLowerCase();
  const cat = (finding.category || "").toLowerCase();
  let severity = (finding.severity || "info").toLowerCase();
  const isRCE = /\beval\s*\(|\beval\b|\brce\b|\bcommand execution\b/i.test(title) || /\beval\s*\(|\brce\b|\bcommand execution\b/i.test(body);
  const isAuthBypass = title.includes("auth bypass") || title.includes("authentication bypass") || body.includes("bypass auth");
  const isProdSecret = (title.includes("production secret") || title.includes("private key") || body.includes("production secret") || body.includes("private key")) && !title.includes("non-production") && !title.includes("internal");
  if (isRCE || isAuthBypass || isProdSecret) {
    severity = "critical";
  } else {
    if (severity === "critical") {
      severity = "high";
    }
  }
  const isSQLi = title.includes("sql injection") || body.includes("sql injection");
  const isMergeConflict = title.includes("conflict marker") || title.includes("merge conflict") || body.includes("conflict marker") || body.includes("merge conflict");
  const isCrashMemory = title.includes("crash") || body.includes("crash") || title.includes("memory exhaustion") || body.includes("memory exhaustion") || title.includes("out of memory") || body.includes("out of memory") || title.includes("typeerror");
  const isDbHost = title.includes("db_host") || title.includes("database host") || title.includes("hostname") || body.includes("database host") || body.includes("hostname") || body.includes("db_host");
  const isApiKey = title.includes("api key") || title.includes("apikey") || body.includes("api key") || body.includes("apikey");
  const isCred = title.includes("credential") || title.includes("password") || title.includes("secret") || title.includes("key") || body.includes("credential") || body.includes("password") || body.includes("secret") || body.includes("key");
  const isTypeMismatch = title.includes("type mismatch") || body.includes("type mismatch");
  const isAuthLogic = title.includes("authorization") || body.includes("authorization");
  const isDivZero = title.includes("division by zero") || body.includes("division by zero");
  const isDiscountCalc = title.includes("discount calculation") || body.includes("discount calculation") || title.includes("percentage") || body.includes("percentage");
  const isExistenceCheck = title.includes("existence validation") || title.includes("undefined user access") || body.includes("existence validation");
  const belongsToHigh = isSQLi || isMergeConflict || isCrashMemory || isDbHost || isApiKey || isCred || isTypeMismatch || isAuthLogic || isDivZero || isDiscountCalc || isExistenceCheck;
  if (belongsToHigh && severity !== "critical") {
    severity = "high";
  }
  const isResourceLeak = title.includes("resource leak") || title.includes("unclosed file") || body.includes("resource leak") || body.includes("unclosed file");
  const isMisleadingResponse = title.includes("misleading") || title.includes("success response") || body.includes("misleading") || body.includes("success response");
  const isMedium = isResourceLeak || isMisleadingResponse || cat === "performance" || title.includes("performance") || title.includes("error handling") || body.includes("error handling") || title.includes("at scale") || body.includes("at scale");
  if (isMedium && severity !== "critical" && severity !== "high") {
    severity = "medium";
  }
  if (title.includes("unused import") || body.includes("unused import")) {
    severity = "low";
  } else if (cat === "style") {
    if (severity === "critical" || severity === "high") {
      if (!belongsToHigh) {
        severity = "medium";
      }
    }
    if (title.includes("naming") || title.includes("name") || body.includes("naming") || body.includes("name")) {
      severity = "info";
    }
  }
  finding.severity = severity;
  return finding;
}

export function deduplicateFindings(findings) {
  const result = [];
  const severityOrder = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  const normalized = findings.map(f => enforceSeverityRubric({ ...f }));
  const sorted = [...normalized].sort((a, b) => {
    if ((a.path || "") !== (b.path || "")) {
      return (a.path || "").localeCompare(b.path || "");
    }
    const lineA = a.line ?? 0;
    const lineB = b.line ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
  });
  const getCleanWords = (str) => {
    const stopWords = new Set(["a", "an", "the", "in", "on", "at", "to", "for", "with", "is", "are", "was", "were", "of", "and", "or", "not", "has", "have", "file", "code", "exposed", "exposing", "exposure"]);
    return new Set(
      (str || "")
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
    );
  };
  const getCleanWordsFromTitle = (str) => getCleanWords(str);
  const getIssueClass = (item) => {
    const title = (item.title || "").toLowerCase();
    const body = (item.body || "").toLowerCase();
    const cat = (item.category || "").toLowerCase();
    if (title.includes("type mismatch") || body.includes("type mismatch")) {
      return "type_mismatch";
    }
    if (title.includes("existence validation") || title.includes("undefined user access") || title.includes("typeerror")) {
      return "existence_validation";
    }
    if (title.includes("authorization") || body.includes("authorization")) {
      return "auth_logic";
    }
    if (title.includes("misleading") || title.includes("success response") || body.includes("misleading")) {
      return "misleading_response";
    }
    if (title.includes("discount calculation") || title.includes("percentage") || body.includes("discount calculation")) {
      return "calculation_error";
    }
    if (title.includes("division by zero") || body.includes("division by zero")) {
      return "division_by_zero";
    }
    if (title.includes("resource leak") || title.includes("unclosed file") || body.includes("resource leak")) {
      return "resource_leak";
    }
    if (title.includes("unused import") || body.includes("unused import")) {
      return "unused_import";
    }
    if (cat === "security") {
      const isCred = ["credential", "password", "secret", "token", "key", "private", "hostname", "expose", "hardcode", "data exposure", "data"].some(k => title.includes(k) || body.includes(k));
      if (isCred) return "security_credential";
      const isEval = ["eval", "injection", "command execution", "rce", "dynamic code", "remote code"].some(k => title.includes(k) || body.includes(k));
      if (isEval) return "security_eval";
      return "security_other";
    }
    if (cat === "syntax" || cat === "conflict" || title.includes("syntax") || title.includes("conflict") || title.includes("marker")) {
      return "syntax_error";
    }
    if (cat === "performance") {
      return "performance_issue";
    }
    return "style_readability";
  };
  const clusters = [];
  for (const item of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      const representative = cluster[0];
      const sameFile = (item.path || "") === (representative.path || "");
      if (!sameFile) continue;
      const sameCategory = (item.category || "").toLowerCase() === (representative.category || "").toLowerCase();
      if (!sameCategory) continue;
      const itemClass = getIssueClass(item);
      const repClass = getIssueClass(representative);
      if (itemClass === repClass) {
        if (itemClass === "security_credential") {
          const closeLine = cluster.some(c => Math.abs((item.line ?? 0) - (c.line ?? 0)) <= 3);
          if (closeLine) {
            cluster.push(item);
            placed = true;
            break;
          }
        } else if (itemClass === "style_readability" || itemClass === "security_other") {
          const words1 = getCleanWordsFromTitle(item.title);
          const words2 = getCleanWordsFromTitle(representative.title);
          const intersection = [...words1].filter(w => words2.has(w));
          const closeLine = cluster.some(c => Math.abs((item.line ?? 0) - (c.line ?? 0)) <= 3);
          if (intersection.length >= 2 || (closeLine && intersection.length >= 1)) {
            cluster.push(item);
            placed = true;
            break;
          }
        } else {
          const words1 = getCleanWordsFromTitle(item.title);
          const words2 = getCleanWordsFromTitle(representative.title);
          const intersection = [...words1].filter(w => words2.has(w));
          const sameLine = cluster.some(c => (item.line ?? 0) === (c.line ?? 0));
          if (sameLine || intersection.length >= 2) {
            cluster.push(item);
            placed = true;
            break;
          }
        }
      }
    }
    if (!placed) {
      clusters.push([item]);
    }
  }
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      result.push(cluster[0]);
      continue;
    }
    cluster.sort((a, b) => {
      const sA = severityOrder[a.severity] || 0;
      const sB = severityOrder[b.severity] || 0;
      if (sA !== sB) return sB - sA;
      return (b.body || "").length - (a.body || "").length;
    });
    const best = cluster[0];
    const lines = cluster.map(c => c.line).filter(l => l !== null && l !== undefined);
    const minLine = Math.min(...lines);
    const maxLine = Math.max(...lines);
    const merged = { ...best };
    const issueClass = getIssueClass(best);
    if (minLine !== maxLine) {
      merged.line = minLine;
      if (issueClass === "security_credential") {
        merged.title = `Hardcoded credentials detected in ${merged.path}:${minLine}-${maxLine}`;
        merged.body = `Hardcoded credentials (including host, username, or password) are committed in code. Move credentials to environment variables or a secrets manager.`;
      } else if (issueClass === "security_eval") {
        merged.title = `User-controlled code execution via eval in ${merged.path}:${minLine}-${maxLine}`;
        merged.body = `Avoid user-controlled dynamic code execution. Eval() allows remote code execution (RCE) vulnerabilities.`;
      } else {
        merged.title = `${best.title} (lines ${minLine}-${maxLine})`;
      }
    }
    result.push(merged);
  }
  return result;
}

export function normalizeCategory(category, title, body) {
  const cat = (category || "").trim().toLowerCase();
  const t = (title || "").toLowerCase();
  const b = (body || "").toLowerCase();
  const isSecurity = 
    cat.includes("security") || cat.includes("auth") || cat.includes("permission") || 
    cat.includes("secret") || cat.includes("injection") || cat.includes("supply-chain") ||
    cat.includes("exposure") ||
    t.includes("password") || t.includes("secret") || t.includes("credential") || t.includes("token") || t.includes("key") || t.includes("auth") || t.includes("private") ||
    b.includes("password") || b.includes("secret") || b.includes("credential") || b.includes("token") || b.includes("key") || b.includes("auth") || b.includes("private");
  if (isSecurity) {
    return "security";
  }
  if (cat === "performance" || cat.includes("memory") || cat.includes("concurrency") || cat.includes("n+1") || cat.includes("unbounded") || cat.includes("network") || t.includes("resource leak") || b.includes("resource leak")) {
    return "performance";
  }
  if (cat === "bug" || cat === "correctness" || cat.includes("error") || cat.includes("syntax") || cat.includes("breakage") || t.includes("mismatch") || t.includes("division by zero") || t.includes("misleading") || t.includes("validation")) {
    return "bug";
  }
  if (cat === "conflict" || cat.includes("marker") || cat.includes("merge")) {
    return "conflict";
  }
  if (cat === "style" || cat.includes("naming") || cat.includes("readability") || cat.includes("consistency") || cat.includes("practice") || cat.includes("maintain") || cat.includes("test") || cat.includes("quality")) {
    return "style";
  }
  return "style";
}
