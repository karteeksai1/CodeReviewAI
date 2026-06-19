import express from "express";
import { listReviewsByPr } from "../db/index.js";
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
  res.json({ waiting, active, delayed, failed, completed });
});

reviewsRouter.get("/pr", requireJwt, async (req, res, next) => {
  try {
    const { owner, repo, number } = req.query;
    if (!owner || !repo || !number) {
      res.status(400).json({ error: "owner, repo, and number are required" });
      return;
    }
    res.json({ reviews: await listReviewsByPr({ owner, repo, number }) });
  } catch (err) {
    next(err);
  }
});
