import express from "express";
import { config } from "../config.js";
import {
  createIndexingJob,
  getDashboardStats,
  getRepoStats,
  getReviewDetail,
  listIndexingJobs,
  listRecentAgentRuns,
  listReviewsByPr,
  updateIndexingJob,
  updateReview,
  upsertRepository,
  query
} from "../db/index.js";
import { requireJwt } from "../middleware/auth.js";
import { reviewQueue } from "../queue/index.js";
import { getInstallationOctokit } from "../services/github.js";

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

reviewsRouter.get("/queue", requireJwt, async (req, res) => {
  const userRepos = await query("select full_name from repositories where user_id = $1", [req.user.sub]);
  const repoSet = new Set(userRepos.rows.map(r => r.full_name));

  const allJobs = await reviewQueue.getJobs(["waiting", "active", "delayed", "failed", "completed"], 0, 1000, false);
  const userJobs = allJobs.filter(job => repoSet.has(job.data?.payload?.repository?.full_name));

  let waiting = 0, active = 0, delayed = 0, failed = 0, completed = 0;
  for (const job of userJobs) {
    const state = await job.getState();
    if (state === "waiting") waiting++;
    else if (state === "active") active++;
    else if (state === "delayed") delayed++;
    else if (state === "failed") failed++;
    else if (state === "completed") completed++;
  }

  const serializedJobs = await Promise.all(userJobs.slice(0, 20).map(async (job) => ({
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

reviewsRouter.get("/stats", requireJwt, async (req, res, next) => {
  try {
    res.json(await getDashboardStats(req.user.sub));
  } catch (err) {
    next(err);
  }
});

reviewsRouter.get("/stats/repo", requireJwt, async (req, res, next) => {
  try {
    const { owner, repo } = req.query;
    if (!owner || !repo) {
      res.status(400).json({ error: "owner and repo are required" });
      return;
    }
    res.json(await getRepoStats(req.user.sub, `${owner}/${repo}`));
  } catch (err) {
    next(err);
  }
});

reviewsRouter.get("/agents", requireJwt, async (req, res, next) => {
  try {
    res.json({ agentRuns: await listRecentAgentRuns(req.user.sub) });
  } catch (err) {
    next(err);
  }
});

reviewsRouter.get("/connect", requireJwt, async (req, res, next) => {
  try {
    res.json({
      githubAppName: config.github.appName ?? "CodeReviewAI",
      installUrl: config.github.installUrl ?? null,
      indexingJobs: await listIndexingJobs(req.user.sub)
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
    await upsertRepository({ full_name: repository }, null, req.user.sub);
    const job = await createIndexingJob(repository, req.user.sub);
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
    const result = await query("delete from indexing_jobs where id = $1 and user_id = $2 returning *", [Number(req.params.id), req.user.sub]);
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
    res.json({ reviews: await listReviewsByPr({ userId: req.user.sub, owner, repo, number: parseInt(String(number), 10) }) });
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
    const review = await getReviewDetail(req.user.sub, req.params.id);
    if (!review) {
      res.status(404).json({ error: "Review not found." });
      return;
    }

    if (review.installation_id) {
      try {
        const [owner, repo] = review.full_name.split("/");
        const octokit = await getInstallationOctokit(Number(review.installation_id));
        const prRes = await octokit.pulls.get({ owner, repo, pull_number: review.number });
        const pullRequest = prRes.data;
        const mergeable = pullRequest.mergeable;
        const mergeableState = pullRequest.mergeable_state;

        let conflictDetails = null;
        if (mergeable === false || mergeableState === "dirty") {
          try {
            const filesRes = await octokit.pulls.listFiles({ owner, repo, pull_number: review.number, per_page: 100 });
            const files = filesRes.data;
            const compareRes = await octokit.repos.compareCommits({
              owner,
              repo,
              base: pullRequest.base.ref,
              head: pullRequest.head.sha
            });
            const mergeBaseSha = compareRes.data.merge_base_commit?.sha;
            if (mergeBaseSha && mergeBaseSha !== pullRequest.base.sha) {
              const baseCompareRes = await octokit.repos.compareCommits({
                owner,
                repo,
                base: mergeBaseSha,
                head: pullRequest.base.ref
              });
              const prFileNames = files.map((file) => file.filename);
              const baseFileNames = baseCompareRes.data.files?.map((file) => file.filename) || [];
              const intersected = prFileNames.filter((file) => baseFileNames.includes(file));
              if (intersected.length > 0) {
                conflictDetails = intersected.join(", ");
              }
            }
          } catch (err) {}
        }

        await updateReview(review.id, {
          mergeable,
          mergeableState,
          conflictDetails
        });
        review.mergeable = mergeable;
        review.mergeable_state = mergeableState;
        review.conflict_details = conflictDetails;
      } catch (err) {}
    }

    res.json({ review });
  } catch (err) {
    next(err);
  }
});
