import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../apps/api/src/config.js";
import { REVIEW_QUEUE_NAME } from "../apps/api/src/queue/index.js";

const jobId = process.argv[2];
if (!jobId) {
  console.error("Please provide a job ID");
  process.exit(1);
}

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(REVIEW_QUEUE_NAME, { connection });

try {
  const job = await queue.getJob(jobId);
  if (!job) {
    console.log("Job not found");
  } else {
    console.log("Failed Reason:", job.failedReason);
    console.log("Stacktrace:", job.stacktrace);
    console.log("Attempts Made:", job.attemptsMade);
    console.log("Options:", JSON.stringify(job.opts, null, 2));
  }
} catch (error) {
  console.error("Error retrieving job:", error);
} finally {
  await queue.close();
  await connection.quit();
}
