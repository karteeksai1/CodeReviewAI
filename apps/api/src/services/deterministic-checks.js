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

export function deduplicateFindings(findings) {
  const result = [];
  const severityOrder = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  for (const item of findings) {
    let merged = false;
    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      const sameFile = (item.path || "") === (existing.path || "");
      const hasLines = item.line !== null && item.line !== undefined && existing.line !== null && existing.line !== undefined;
      const closeLines = hasLines && Math.abs(item.line - existing.line) <= 1;
      if (sameFile && closeLines) {
        const title1 = (item.title || "").toLowerCase();
        const title2 = (existing.title || "").toLowerCase();
        const body1 = (item.body || "").toLowerCase();
        const body2 = (existing.body || "").toLowerCase();
        const words1 = new Set(title1.split(/\W+/).filter(Boolean));
        const words2 = new Set(title2.split(/\W+/).filter(Boolean));
        const intersection = [...words1].filter(w => words2.has(w));
        const overlappingTitle = intersection.length >= 2;
        const isSecret1 = title1.includes("secret") || title1.includes("password") || title1.includes("credential") || title1.includes("token") || title1.includes("key");
        const isSecret2 = title2.includes("secret") || title2.includes("password") || title2.includes("credential") || title2.includes("token") || title2.includes("key");
        const bothSecret = isSecret1 && isSecret2;
        const isSyntax1 = title1.includes("syntax") || title1.includes("parsing") || title1.includes("unresolved") || title1.includes("marker");
        const isSyntax2 = title2.includes("syntax") || title2.includes("parsing") || title2.includes("unresolved") || title2.includes("marker");
        const bothSyntax = isSyntax1 && isSyntax2;
        if (overlappingTitle || bothSecret || bothSyntax) {
          const sev1 = severityOrder[item.severity] || 0;
          const sev2 = severityOrder[existing.severity] || 0;
          if (sev1 > sev2) {
            existing.severity = item.severity;
          }
          if (body1.length > body2.length) {
            existing.title = item.title;
            existing.body = item.body;
          }
          if (item.line < existing.line) {
            existing.line = item.line;
          }
          merged = true;
          break;
        }
      }
    }
    if (!merged) {
      result.push({ ...item });
    }
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
