import crypto from "crypto";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { pool, initDb } from "./db/index.js";
import { connection } from "./queue/index.js";
import { authRouter } from "./routes/auth.js";
import { reviewsRouter } from "./routes/reviews.js";
import { webhookRouter } from "./routes/webhook.js";
import { logger } from "./logger.js";
import { publicError } from "./errors.js";

const app = express();

app.use(cors());
app.get("/health", async (_req, res) => {
  let postgresOk = false;
  try {
    if (pool) {
      await pool.query("SELECT 1");
      postgresOk = true;
    }
  } catch (err) {
    logger.error({ err }, "Postgres health check failed");
  }

  let redisOk = false;
  try {
    if (connection) {
      await connection.ping();
      redisOk = true;
    }
  } catch (err) {
    logger.error({ err }, "Redis health check failed");
  }

  let agentOk = false;
  let pineconeOk = false;
  let groqOk = false;
  try {
    const response = await fetch(`${config.agentUrl.replace(/\/$/, "")}/health`);
    if (response.ok) {
      const data = await response.json();
      agentOk = true;
      pineconeOk = data.pinecone || false;
      groqOk = data.groq || false;
    }
  } catch (err) {
    logger.error({ err }, "Agent health check failed");
  }

  const allOk = postgresOk && redisOk && agentOk && pineconeOk && groqOk;
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "healthy" : "unhealthy",
    postgres: postgresOk,
    redis: redisOk,
    agent: agentOk,
    pinecone: pineconeOk,
    groq: groqOk
  });
});
app.use("/webhook", webhookRouter);
app.use(express.json({ limit: "2mb" }));
app.use("/auth", authRouter);
app.use("/reviews", reviewsRouter);

app.use((req, res) => {
  if (req.method !== "GET") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(404).json({
    error: "Not found",
    hint: "This is the CodeReviewAI API. Open the dashboard at http://localhost:3000/login"
  });
});

app.use((err, req, res, _next) => {
  const requestId = crypto.randomUUID();
  logger.error({ err, stack: err.stack, requestId, path: req.path, method: req.method }, "unhandled exception");
  const { statusCode, message } = publicError(err);
  res.status(statusCode).json({
    error: `${message} (Request ID: ${requestId})`,
    requestId
  });
});

await initDb();

app.listen(config.port, () => {
  logger.info({ port: config.port }, "CodeReviewAI API listening");
});
