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
  const sorted = [...findings].sort((a, b) => {
    if ((a.path || "") !== (b.path || "")) {
      return (a.path || "").localeCompare(b.path || "");
    }
    const lineA = a.line ?? 0;
    const lineB = b.line ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
  });
  const stopWords = new Set(["a", "an", "the", "in", "on", "at", "to", "for", "with", "is", "are", "was", "were", "of", "and", "or", "not", "has", "have", "file", "code", "exposed", "exposing", "exposure"]);
  const getCleanWords = (str) => {
    return new Set(
      (str || "")
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
    );
  };
  const clusters = [];
  for (const item of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      const representative = cluster[0];
      const sameFile = (item.path || "") === (representative.path || "");
      if (!sameFile) continue;
      let closeLine = false;
      for (const clusterItem of cluster) {
        const dist = Math.abs((item.line ?? 0) - (clusterItem.line ?? 0));
        if (dist <= 3) {
          closeLine = true;
          break;
        }
      }
      if (!closeLine) continue;
      const itemTitle = (item.title || "").toLowerCase();
      const repTitle = (representative.title || "").toLowerCase();
      const isSecurity = item.category === "security" && representative.category === "security";
      const isSyntax = item.category === "syntax" && representative.category === "syntax";
      let similar = false;
      if (isSecurity) {
        const secKeywords = ["password", "secret", "credential", "token", "key", "auth", "private", "expose", "hardcode"];
        const hasSec1 = secKeywords.some(k => itemTitle.includes(k) || (item.body || "").toLowerCase().includes(k));
        const hasSec2 = secKeywords.some(k => repTitle.includes(k) || (representative.body || "").toLowerCase().includes(k));
        if (hasSec1 && hasSec2) {
          similar = true;
        }
      } else if (isSyntax) {
        similar = true;
      } else {
        const words1 = getCleanWords(item.title);
        const words2 = getCleanWords(representative.title);
        const intersection = [...words1].filter(w => words2.has(w));
        if (intersection.length >= 1) {
          similar = true;
        }
      }
      if (similar) {
        cluster.push(item);
        placed = true;
        break;
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
    const isSecurity = cluster.every(c => c.category === "security");
    if (isSecurity && minLine !== maxLine) {
      merged.title = `Hardcoded credentials detected in ${merged.path}:${minLine}-${maxLine}`;
      merged.body = `Hardcoded credentials (including host, username, or password) are committed in code. Move credentials to environment variables or a secrets manager.`;
      merged.line = minLine;
    } else {
      if (minLine !== maxLine) {
        merged.line = minLine;
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
