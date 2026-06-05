import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";

export const REVIEW_QUEUE_NAME = "pr_review";
export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export const reviewQueue = new Queue(REVIEW_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
    removeOnFail: { age: 60 * 60 * 24 * 14 }
  }
});

export const reviewQueueEvents = new QueueEvents(REVIEW_QUEUE_NAME, { connection });

const PRIORITY = { pull_request: 2, push: 5, pull_request_review: 6, draftPullRequest: 8 };

export async function enqueueReview(eventName, payload) {
  const priority = eventName === "pull_request" && payload.pull_request?.draft
    ? PRIORITY.draftPullRequest
    : PRIORITY[eventName] ?? PRIORITY.pull_request;
  const dedupeId = [
    eventName,
    payload.repository?.full_name,
    payload.pull_request?.number ?? payload.after ?? payload.review?.id,
    payload.pull_request?.head?.sha ?? payload.after ?? Date.now()
  ].filter(Boolean).join(":");
  return reviewQueue.add("review", { eventName, payload, enqueuedAt: new Date().toISOString() }, { jobId: dedupeId, priority });
}
