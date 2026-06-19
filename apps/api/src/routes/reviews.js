import express from "express";
import { config } from "../config.js";
import {
  createIndexingJob,
  getDashboardStats,
  getReviewDetail,
  listIndexingJobs,
  listRecentAgentRuns,
  listReviewsByPr
} from "../db/index.js";
import { requireJwt } from "../middleware/auth.js";
import { reviewQueue } from "../queue/index.js";

export const reviewsRouter = express.Router();

reviewsRouter.get("/queue", requireJwt, async (_req, res) => {
  const [waiting, active, delayed, failed, completed] = await Promise.all([
    reviewQueue.getWaitingCount(),
    reviewQueue.getActiveCount(),
    reviewQueue.getDelayedCount(),
    reviewQueue.getFailedCount(),
    reviewQueue.getCompletedCount()
  ]);
  const jobs = await reviewQueue.getJobs(["waiting", "active", "delayed", "failed", "completed"], 0, 20, false);
  const serializedJobs = await Promise.all(jobs.map(async (job) => ({
    id: job.id,
    name: job.name,
    state: await job.getState(),
    eventName: job.data?.eventName,
    repository: job.data?.payload?.repository?.full_name,
    pullNumber: job.data?.payload?.pull_request?.number,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    failedReason: job.failedReason
  })));
  res.json({
    waiting,
    active,
    delayed,
    failed,
    completed,
    jobs: serializedJobs
  });
});

reviewsRouter.get("/stats", requireJwt, async (_req, res, next) => {
  try {
    res.json(await getDashboardStats());
  } catch (err) {
    next(err);
  }
});

reviewsRouter.get("/agents", requireJwt, async (_req, res, next) => {
  try {
    res.json({ agentRuns: await listRecentAgentRuns() });
  } catch (err) {
    next(err);
  }
});

reviewsRouter.get("/connect", requireJwt, async (_req, res, next) => {
  try {
    res.json({
      githubAppName: config.github.appName ?? "CodeReviewAI",
      installUrl: config.github.installUrl ?? null,
      indexingJobs: await listIndexingJobs()
    });
  } catch (err) {
    next(err);
  }
});

reviewsRouter.post("/indexing", requireJwt, async (req, res, next) => {
  try {
    const repository = String(req.body?.repository ?? "").trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
      res.status(400).json({ error: "Enter a repository as owner/name." });
      return;
    }
    const job = await createIndexingJob(repository);
    res.status(202).json({ indexingJob: job });
  } catch (err) {
    next(err);
  }
});

reviewsRouter.get("/pr", requireJwt, async (req, res, next) => {
  try {
    const { owner, repo, number } = req.query;
    if (!owner || !repo || !number) {
      res.status(400).json({ error: "owner, repo, and number are required" });
      return;
    }
    if (!/^\d+$/.test(String(number))) {
      res.status(400).json({ error: "PR number must be numeric." });
      return;
    }
    res.json({ reviews: await listReviewsByPr({ owner, repo, number }) });
  } catch (err) {
    next(err);
  }
});

reviewsRouter.get("/:id", requireJwt, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      res.status(400).json({ error: "Review id must be numeric." });
      return;
    }
    const review = await getReviewDetail(req.params.id);
    if (!review) {
      res.status(404).json({ error: "Review not found." });
      return;
    }
    res.json({ review });
  } catch (err) {
    next(err);
  }
});
