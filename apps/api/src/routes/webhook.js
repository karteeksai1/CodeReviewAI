import crypto from "crypto";
import express from "express";
import { config } from "../config.js";
import { enqueueReview } from "../queue/index.js";
import { logger } from "../logger.js";

export const webhookRouter = express.Router();

webhookRouter.post("/", express.raw({ type: "*/*", limit: "5mb" }), async (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress;
  try {
    verifySignature(req, ip);
    const eventName = req.header("x-github-event");
    const deliveryId = req.header("x-github-delivery");
    if (!req.body || req.body.length === 0) {
      res.status(400).json({ error: "Empty request body" });
      return;
    }
    const bodyStr = req.body.toString("utf8");
    let payload;
    const contentType = req.header("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(bodyStr);
      const payloadStr = params.get("payload");
      if (!payloadStr) {
        res.status(400).json({ error: "Missing payload parameter" });
        return;
      }
      payload = JSON.parse(payloadStr);
    } else {
      payload = JSON.parse(bodyStr);
    }
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

function verifySignature(req, ip) {
  if (!config.webhookSecret || config.webhookSecret === "replace-me") {
    if (config.nodeEnv !== "production") {
      logger.warn({ ip }, "Skipping signature verification in non-production because GITHUB_WEBHOOK_SECRET is not set or is replace-me");
      return;
    }
    const err = new Error("GITHUB_WEBHOOK_SECRET is required in production");
    err.statusCode = 500;
    throw err;
  }
  const signature = req.header("x-hub-signature-256");
  if (!signature) {
    logger.error({ ip, reason: "Missing x-hub-signature-256 header" }, "Webhook verification failed");
    const err = new Error("Missing GitHub signature");
    err.statusCode = 401;
    throw err;
  }
  const expected = `sha256=${crypto.createHmac("sha256", config.webhookSecret).update(req.body).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    logger.error({ ip, reason: "Invalid HMAC signature match" }, "Webhook verification failed");
    const err = new Error("Invalid GitHub signature");
    err.statusCode = 401;
    throw err;
  }
}
