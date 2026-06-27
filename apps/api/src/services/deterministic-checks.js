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
