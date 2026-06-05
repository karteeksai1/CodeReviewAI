import crypto from "crypto";
import express from "express";
import { config } from "../config.js";
import { enqueueReview } from "../queue/index.js";

export const webhookRouter = express.Router();

webhookRouter.post("/", express.raw({ type: "application/json", limit: "5mb" }), async (req, res, next) => {
  try {
    verifySignature(req);
    const eventName = req.header("x-github-event");
    const deliveryId = req.header("x-github-delivery");
    const payload = JSON.parse(req.body.toString("utf8"));
    if (!shouldQueue(eventName, payload)) {
      res.status(202).json({ accepted: true, queued: false, deliveryId });
      return;
    }
    const job = await enqueueReview(eventName, payload);
    res.status(202).json({ accepted: true, queued: true, jobId: job.id, deliveryId });
  } catch (err) {
    next(err);
  }
});

function shouldQueue(eventName, payload) {
  if (eventName === "pull_request") {
    return ["opened", "reopened", "synchronize", "ready_for_review", "converted_to_draft"].includes(payload.action);
  }
  if (eventName === "push") return Boolean(payload.repository?.full_name && payload.after);
  if (eventName === "pull_request_review") return payload.action === "submitted";
  return false;
}

function verifySignature(req) {
  if (!config.webhookSecret) {
    if (config.nodeEnv !== "production") return;
    const err = new Error("GITHUB_WEBHOOK_SECRET is required in production");
    err.statusCode = 500;
    throw err;
  }
  const signature = req.header("x-hub-signature-256");
  if (!signature) {
    const err = new Error("Missing GitHub signature");
    err.statusCode = 401;
    throw err;
  }
  const expected = `sha256=${crypto.createHmac("sha256", config.webhookSecret).update(req.body).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error("Invalid GitHub signature");
    err.statusCode = 401;
    throw err;
  }
}
