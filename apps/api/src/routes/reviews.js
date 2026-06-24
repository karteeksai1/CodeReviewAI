import express from "express";
import { config } from "../config.js";
import {
  createIndexingJob,
  getDashboardStats,
  getReviewDetail,
  listIndexingJobs,
  listRecentAgentRuns,
  listReviewsByPr,
  updateIndexingJob,
  query
} from "../db/index.js";
import { requireJwt } from "../middleware/auth.js";
import { reviewQueue } from "../queue/index.js";

export const reviewsRouter = express.Router();

const rateLimitMap = new Map();
function rateLimiter({ windowMs, max }) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress;
    const now = Date.now();
    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, []);
    }
    const timestamps = rateLimitMap.get(ip).filter((t) => now - t < windowMs);
    if (timestamps.length >= max) {
      res.status(429).json({ error: "Too many requests, please try again later." });
      return;
    }
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);
    next();
  };
}

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

reviewsRouter.post("/queue/jobs/*/retry", requireJwt, async (req, res, next) => {
  try {
    const job = await reviewQueue.getJob(req.params[0]);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    await job.retry();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

reviewsRouter.delete("/queue/jobs/*", requireJwt, async (req, res, next) => {
  try {
    const job = await reviewQueue.getJob(req.params[0]);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    await job.remove();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
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

reviewsRouter.post("/indexing", requireJwt, rateLimiter({ windowMs: 60 * 1000, max: 10 }), async (req, res, next) => {
  try {
    const repository = String(req.body?.repository ?? "").trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
      res.status(400).json({ error: "Enter a repository as owner/name." });
      return;
    }
    const job = await createIndexingJob(repository);
    (async () => {
      try {
        await updateIndexingJob(job.id, { status: "indexing", message: "Cloning and embedding repository" });
        const response = await fetch(`${config.agentUrl.replace(/\/$/, "")}/index`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            repo_path: repository,
            namespace: repository
          })
        });
        if (!response.ok) {
          throw new Error(`Agent indexing failed: ${await response.text()}`);
        }
        const result = await response.json();
        await updateIndexingJob(job.id, {
          status: "completed",
          chunks: result.chunks,
          embedded: result.chunks,
          message: "Codebase indexed successfully"
        });
      } catch (err) {
        await updateIndexingJob(job.id, {
          status: "failed",
          message: err.message
        });
      }
    })();
    res.status(202).json({ indexingJob: job });
  } catch (err) {
    next(err);
  }
});

reviewsRouter.delete("/indexing/:id", requireJwt, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      res.status(400).json({ error: "Job id must be numeric." });
      return;
    }
    const result = await query("delete from indexing_jobs where id = $1 returning *", [Number(req.params.id)]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Indexing job not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

reviewsRouter.get("/pr", requireJwt, rateLimiter({ windowMs: 60 * 1000, max: 30 }), async (req, res, next) => {
  try {
    const { owner, repo, number } = req.query;
    if (!owner || !repo || !number) {
      res.status(400).json({ error: "owner, repo, and number are required" });
      return;
    }
    if (!/^[1-9]\d*$/.test(String(number))) {
      res.status(400).json({ error: "PR number must be a positive integer without leading zeros." });
      return;
    }
    res.json({ reviews: await listReviewsByPr({ owner, repo, number: parseInt(String(number), 10) }) });
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
