import { Worker } from "bullmq";
import crypto from "crypto";
import { config } from "../config.js";
import { createReview, initDb, insertFindings, query, updateReview, upsertAgentRuns, upsertPullRequest, upsertRepository } from "../db/index.js";
import { logger } from "../logger.js";
import { requestAgentReview } from "../services/agent-bridge.js";
import { fetchPullRequestContext, postReviewSummary } from "../services/github.js";
import { connection, REVIEW_QUEUE_NAME } from "./index.js";

await initDb();

const worker = new Worker(REVIEW_QUEUE_NAME, async (job) => {
  const { eventName, payload } = job.data;
  if (eventName !== "pull_request") return { skipped: true };

  const repository = payload.repository;
  const pullRequest = payload.pull_request;
  const installationId = payload.installation?.id;
  const [owner, repo] = repository.full_name.split("/");
  
  let userId = null;
  if (installationId) {
    const res = await query("select user_id from repositories where installation_id = $1 and user_id is not null limit 1", [installationId]).catch(() => ({ rows: [] }));
    if (res.rows[0]) userId = res.rows[0].user_id;
  }
  
  const repoRow = await upsertRepository(repository, installationId, userId);
  const prRow = await upsertPullRequest(repoRow?.id, pullRequest);
  const review = await createReview({ pullRequestId: prRow?.id, queueJobId: String(job.id), status: "in_progress" });
  await upsertAgentRuns(review?.id, ["security", "performance", "style"].map((agent) => ({
    agent,
    status: "running",
    startedAt: new Date()
  })));

  const requestId = crypto.randomUUID();
  try {
    const context = await fetchPullRequestContext({ owner, repo, pullNumber: pullRequest.number, installationId });
    const agentResult = await requestAgentReview(context, requestId);
    const findings = agentResult.findings ?? [];
    await insertFindings(review?.id, findings);
    await upsertAgentRuns(review?.id, agentResult.agent_runs ?? []);
    const posted = await postReviewSummary({ owner, repo, pullNumber: pullRequest.number, installationId, headSha: context.pullRequest.headSha, summary: agentResult.summary, findings });
    await updateReview(review?.id, { status: "completed", summary: agentResult.summary, riskScore: agentResult.risk_score, postedToGithub: posted, completedAt: new Date() });
    return { findings: findings.length, riskScore: agentResult.risk_score, posted };
  } catch (err) {
    await upsertAgentRuns(review?.id, ["security", "performance", "style"].map((agent) => ({
      agent,
      status: "failed",
      completedAt: new Date(),
      error: err.message
    })));
    await updateReview(review?.id, { status: "failed", error: err.message, completedAt: new Date() });
    throw err;
  }
}, { connection, concurrency: config.queueConcurrency });

worker.on("completed", (job, result) => logger.info({ jobId: job.id, result }, "review job completed"));
worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "review job failed"));
logger.info({ concurrency: config.queueConcurrency }, "review worker started");
