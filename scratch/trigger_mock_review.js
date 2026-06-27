import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { requestAgentReview } from "../apps/api/src/services/agent-bridge.js";
import { createReview, initDb, insertFindings, query, updateReview, upsertAgentRuns, upsertPullRequest, upsertRepository } from "../apps/api/src/db/index.js";
import { runDeterministicChecks, deduplicateFindings, normalizeCategory } from "../apps/api/src/services/deterministic-checks.js";

const rootEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
dotenv.config({ path: rootEnvPath });

await initDb();

async function main() {
  const repository = {
    id: 999999,
    name: "mock-repo",
    full_name: "mockowner/mock-repo",
    owner: "mockowner",
    default_branch: "main"
  };

  const pullRequest = {
    id: 999999,
    number: 1,
    title: "Mock PR for multi-file and deleted files verification",
    user: { login: "mockuser" },
    head: { sha: "mockheadsha123456789" },
    base: { sha: "mockbasesha123456789" },
    draft: false,
    state: "open",
    html_url: "https://github.com/mockowner/mock-repo/pull/1"
  };

  const repoRow = await upsertRepository(repository, 123456789, 5);
  const prRow = await upsertPullRequest(repoRow.id, pullRequest);

  const jobId = "mock-job-id-" + Date.now();
  const review = await createReview({
    pullRequestId: prRow.id,
    queueJobId: jobId,
    status: "in_progress",
    headSha: pullRequest.head?.sha,
    baseSha: pullRequest.base?.sha
  });

  const files = [
    {
      path: "authUtils.js",
      status: "modified",
      additions: 15,
      deletions: 0,
      changes: 15,
      patch: `@@ -1,5 +1,18 @@
 const fs = require('fs');
 function authenticateUser(username, password) {
-    var dbPassword = "old";
+    var dbPassword = "superSecretPassword123";
+    var isAuthenticated = false;
+    if (password == dbPassword) {
+        isAuthenticated = true;
+    }
+    eval("console.log('User ' + username + ' logged in')");
+    return isAuthenticated;
+}`
    },
    {
      path: "deleted_file.js",
      status: "removed",
      additions: 0,
      deletions: 10,
      changes: 10,
      patch: `@@ -1,10 +0,0 @@
-const token = "ghp_staleCredentialToken12345";
-function oldHelper() {
-    console.log("This file is deleted");
-}`
    }
  ];

  const context = {
    repository: { owner: repository.owner, name: repository.name, fullName: repository.full_name },
    pullRequest: {
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      body: "Test body",
      author: pullRequest.user.login,
      baseSha: pullRequest.base.sha,
      headSha: pullRequest.head.sha,
      isDraft: false,
      url: pullRequest.html_url,
      mergeable: false,
      mergeableState: "dirty",
      conflictDetails: "authUtils.js"
    },
    files,
    diff: "diff mock"
  };

  console.log("Sending mock context to agent...");
  const agentResult = await requestAgentReview(context, crypto.randomUUID());
  console.log("Agent result received.");
  
  const rawFindings = agentResult.findings ?? [];
  const deterministicFindings = runDeterministicChecks(files);
  rawFindings.push(...deterministicFindings);
  const normalizedRaw = rawFindings.map((f) => ({
    ...f,
    category: normalizeCategory(f.category, f.title, f.body)
  }));
  const findings = deduplicateFindings(normalizedRaw);
  console.log("Findings count:", findings.length);
  console.log(JSON.stringify(findings, null, 2));

  await insertFindings(review.id, findings);
  const finalAgentRuns = (agentResult.agent_runs ?? []).map((run) => {
    let count = 0;
    if (run.agent === "security") {
      count = findings.filter((f) => f.category === "security").length;
    } else if (run.agent === "performance") {
      count = findings.filter((f) => f.category === "performance").length;
    } else if (run.agent === "style") {
      count = findings.filter((f) => f.category !== "security" && f.category !== "performance").length;
    } else {
      count = findings.filter((f) => f.category === run.agent).length;
    }
    return {
      ...run,
      finding_count: count
    };
  });
  await upsertAgentRuns(review.id, finalAgentRuns);
  
  let finalSummary = agentResult.summary;
  let finalRiskScore = agentResult.risk_score;
  if (deterministicFindings.length > 0) {
    const severityWeights = { critical: 10, high: 7, medium: 4, low: 2, info: 0 };
    const sumWeights = findings.reduce((sum, item) => sum + (severityWeights[item.severity] ?? 0), 0);
    finalRiskScore = Math.min(100, Math.round((sumWeights / 3) * 100) / 100);
    const sorted = [...findings].sort((a, b) => (severityWeights[b.severity] ?? 0) - (severityWeights[a.severity] ?? 0));
    const highestPriority = sorted[0];
    finalSummary = `Detected ${findings.length} finding(s). Highest priority: ${highestPriority.severity} ${highestPriority.category} issue, ${highestPriority.title}.`;
  }

  await updateReview(review.id, {
    status: "completed",
    summary: finalSummary,
    riskScore: finalRiskScore,
    completedAt: new Date(),
    mergeable: false,
    mergeableState: "dirty",
    conflictDetails: "authUtils.js"
  });

  console.log("Review completed and saved to database successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Mock run failed:", err);
  process.exit(1);
});
