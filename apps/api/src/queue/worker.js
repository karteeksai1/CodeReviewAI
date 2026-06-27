import { Worker } from "bullmq";
import crypto from "crypto";
import { config } from "../config.js";
import { createReview, initDb, insertFindings, query, updateReview, upsertAgentRuns, upsertPullRequest, upsertRepository } from "../db/index.js";
import { logger } from "../logger.js";
import { requestAgentReview } from "../services/agent-bridge.js";
import { fetchPullRequestContext, postReviewSummary } from "../services/github.js";
import { runDeterministicChecks } from "../services/deterministic-checks.js";
import { connection, REVIEW_QUEUE_NAME } from "./index.js";

await initDb();

function isNonRetryableError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || err.response?.status;
  if (status && status >= 400 && status < 500 && status !== 429) {
    return true;
  }
  const msg = (err.message || "").toLowerCase();
  if (msg.includes("unprocessable entity") || msg.includes("validation failed") || msg.includes("422") || msg.includes("400") || msg.includes("403") || msg.includes("401") || msg.includes("404")) {
    if (!msg.includes("429")) {
      return true;
    }
  }
  return false;
}

const worker = new Worker(REVIEW_QUEUE_NAME, async (job) => {
  const { eventName, payload } = job.data;
  if (eventName !== "pull_request") return { skipped: true };

  const repository = payload.repository;
  const pullRequest = payload.pull_request;
  const installationId = payload.installation?.id;
  const [owner, repo] = repository.full_name.split("/");
  
  let userId = null;
  const repoRes = await query("select user_id from repositories where full_name = $1", [repository.full_name]).catch(() => ({ rows: [] }));
  if (repoRes.rows[0]?.user_id) {
    userId = repoRes.rows[0].user_id;
  } else if (installationId) {
    const res = await query("select user_id from repositories where installation_id = $1 and user_id is not null limit 1", [installationId]).catch(() => ({ rows: [] }));
    if (res.rows[0]) userId = res.rows[0].user_id;
  }
  
  const repoRow = await upsertRepository(repository, installationId, userId);
  const prRow = await upsertPullRequest(repoRow?.id, pullRequest);
  let review;
  const existingReviewRes = await query("select * from reviews where queue_job_id = $1", [String(job.id)]);
  if (existingReviewRes.rows[0]) {
    review = existingReviewRes.rows[0];
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts?.attempts || 5;
    const retryStatus = `retrying (attempt ${attempt}/${maxAttempts})`;
    await updateReview(review.id, { status: retryStatus, error: null, completedAt: null });
    await upsertAgentRuns(review.id, ["security", "performance", "style"].map((agent) => ({
      agent,
      status: retryStatus,
      error: null
    })));
    await query("delete from findings where review_id = $1", [review.id]);
    await updateReview(review.id, { status: "in_progress" });
    await upsertAgentRuns(review.id, ["security", "performance", "style"].map((agent) => ({
      agent,
      status: "running",
      startedAt: new Date()
    })));
  } else {
    review = await createReview({
      pullRequestId: prRow?.id,
      queueJobId: String(job.id),
      status: "in_progress",
      headSha: pullRequest.head?.sha,
      baseSha: pullRequest.base?.sha
    });
    await upsertAgentRuns(review?.id, ["security", "performance", "style"].map((agent) => ({
      agent,
      status: "running",
      startedAt: new Date()
    })));
  }

  const requestId = crypto.randomUUID();
  try {
    const context = await fetchPullRequestContext({ owner, repo, pullNumber: pullRequest.number, installationId });
    await updateReview(review?.id, {
      mergeable: context.pullRequest.mergeable,
      mergeableState: context.pullRequest.mergeableState,
      conflictDetails: context.pullRequest.conflictDetails
    });
    const agentResult = await requestAgentReview(context, requestId);
    const findings = agentResult.findings ?? [];
    const deterministicFindings = runDeterministicChecks(context.files);
    findings.push(...deterministicFindings);
    await insertFindings(review?.id, findings);
    await upsertAgentRuns(review?.id, agentResult.agent_runs ?? []);
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
    const posted = await postReviewSummary({ owner, repo, pullNumber: pullRequest.number, installationId, headSha: context.pullRequest.headSha, summary: finalSummary, findings, files: context.files });
    await updateReview(review?.id, { status: "completed", summary: finalSummary, riskScore: finalRiskScore, postedToGithub: posted, completedAt: new Date() });
    return { findings: findings.length, riskScore: finalRiskScore, posted };
  } catch (err) {
    let message = err.message || String(err);
    const nonRetryable = isNonRetryableError(err);
    if (nonRetryable) {
      message = `[unrecoverable] ${message}`;
      try {
        await job.discard();
      } catch (discardErr) {
        logger.error({ jobId: job.id, err: discardErr }, "failed to discard job");
      }
    }
    await upsertAgentRuns(review?.id, ["security", "performance", "style"].map((agent) => ({
      agent,
      status: "failed",
      completedAt: new Date(),
      error: message
    })));
    await updateReview(review?.id, { status: "failed", error: message, completedAt: new Date() });
    if (nonRetryable) {
      const wrappedErr = new Error(message);
      wrappedErr.status = err.status;
      throw wrappedErr;
    }
    throw err;
  }
}, { connection, concurrency: config.queueConcurrency });

worker.on("completed", (job, result) => logger.info({ jobId: job.id, result }, "review job completed"));
worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "review job failed"));
logger.info({ concurrency: config.queueConcurrency }, "review worker started");
