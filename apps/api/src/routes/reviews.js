import express from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { listReviewsByPr } from "../db/index.js";
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

reviewsRouter.get("/pr", async (req, res, next) => {
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

function requireJwt(req, res, next) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: "Invalid bearer token" });
  }
}
