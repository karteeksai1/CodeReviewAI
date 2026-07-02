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
    }
  }
  return findings;
}

export function enforceSeverityRubric(finding) {
  const title = (finding.title || "").toLowerCase();
  const body = (finding.body || "").toLowerCase();
  const cat = (finding.category || "").toLowerCase();
  let severity = (finding.severity || "info").toLowerCase();
  const isRCE = title.includes("eval") || body.includes("eval") || title.includes("rce") || title.includes("command execution");
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
  const isCrashMemory = title.includes("crash") || body.includes("crash") || title.includes("memory exhaustion") || body.includes("memory exhaustion") || title.includes("out of memory") || body.includes("out of memory");
  const isDbHost = title.includes("db_host") || title.includes("database host") || title.includes("hostname") || body.includes("database host") || body.includes("hostname") || body.includes("db_host");
  const isApiKey = title.includes("api key") || title.includes("apikey") || body.includes("api key") || body.includes("apikey");
  const isCred = title.includes("credential") || title.includes("password") || title.includes("secret") || title.includes("key") || body.includes("credential") || body.includes("password") || body.includes("secret") || body.includes("key");
  const belongsToHigh = isSQLi || isMergeConflict || isCrashMemory || isDbHost || isApiKey || isCred;
  if (belongsToHigh && severity !== "critical") {
    severity = "high";
  }
  const isMedium = cat === "performance" || title.includes("performance") || title.includes("error handling") || body.includes("error handling") || title.includes("at scale") || body.includes("at scale");
  if (isMedium && severity !== "critical" && severity !== "high") {
    severity = "medium";
  }
  if (cat === "style") {
    if (severity === "critical" || severity === "high") {
      severity = "medium";
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
        if (itemClass === "style_readability" || itemClass === "security_other") {
          const words1 = getCleanWordsFromTitle(item.title);
          const words2 = getCleanWordsFromTitle(representative.title);
          const intersection = [...words1].filter(w => words2.has(w));
          const closeLine = cluster.some(c => Math.abs((item.line ?? 0) - (c.line ?? 0)) <= 3);
          if (intersection.length >= 1 || closeLine) {
            cluster.push(item);
            placed = true;
            break;
          }
        } else {
          cluster.push(item);
          placed = true;
          break;
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
  if (cat === "security" || cat === "auth" || cat === "permission" || cat === "secret" || cat === "injection" || cat === "supply-chain" || cat.includes("exposure")) {
    return "security";
  }
  if (cat === "performance" || cat.includes("memory") || cat.includes("concurrency") || cat.includes("n+1") || cat.includes("unbounded") || cat.includes("network")) {
    return "performance";
  }
  if (cat === "style" || cat.includes("naming") || cat.includes("readability") || cat.includes("consistency") || cat.includes("practice") || cat.includes("maintain") || cat.includes("test") || cat.includes("quality")) {
    return "style";
  }
  if (cat === "bug" || cat.includes("error") || cat.includes("syntax") || cat.includes("breakage")) {
    return "bug";
  }
  if (cat === "conflict" || cat.includes("marker") || cat.includes("merge")) {
    return "conflict";
  }
  console.warn(`[Warning] Category '${category}' is outside the allowed set, falling back to 'style'`);
  return "style";
}
