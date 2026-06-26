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
const serviceRegistry = {
  postgres: "unknown",
  redis: "unknown",
  agent: "unknown",
  pinecone: "unknown",
  groq: "unknown"
};

async function checkPostgres() {
  try {
    if (pool) {
      await pool.query("SELECT 1");
      serviceRegistry.postgres = "ok";
    } else {
      serviceRegistry.postgres = "down";
    }
  } catch (err) {
    serviceRegistry.postgres = "down";
  }
}

async function checkRedis() {
  try {
    if (connection) {
      await connection.ping();
      serviceRegistry.redis = "ok";
    } else {
      serviceRegistry.redis = "down";
    }
  } catch (err) {
    serviceRegistry.redis = "down";
  }
}

async function checkAgent() {
  try {
    const response = await fetch(`${config.agentUrl.replace(/\/$/, "")}/health`);
    if (response.ok) {
      const data = await response.json();
      if (serviceRegistry.agent !== "checking") {
        serviceRegistry.agent = "ok";
      }
      if (serviceRegistry.pinecone !== "checking") {
        serviceRegistry.pinecone = data.pinecone ? "ok" : "down";
      }
      if (serviceRegistry.groq !== "checking") {
        serviceRegistry.groq = data.groq ? "ok" : "down";
      }
    } else {
      serviceRegistry.agent = "down";
      serviceRegistry.pinecone = "down";
      serviceRegistry.groq = "down";
    }
  } catch (err) {
    serviceRegistry.agent = "down";
    serviceRegistry.pinecone = "down";
    serviceRegistry.groq = "down";
  }
}

function startHealthChecks() {
  checkPostgres();
  checkRedis();
  checkAgent();
  setInterval(() => {
    checkPostgres();
    checkRedis();
    checkAgent();
  }, 5000);
}

app.get("/health", (_req, res) => {
  const allOk = !Object.values(serviceRegistry).includes("down");
  res.status(200).json({
    status: allOk ? "healthy" : "unhealthy",
    postgres: serviceRegistry.postgres,
    redis: serviceRegistry.redis,
    agent: serviceRegistry.agent,
    pinecone: serviceRegistry.pinecone,
    groq: serviceRegistry.groq
  });
});
app.use("/webhook", webhookRouter);
app.use(express.json({ limit: "2mb" }));
app.post("/health/status", (req, res) => {
  let { service, status } = req.body ?? {};
  if (service === "llm") service = "groq";
  if (service === "rag") service = "pinecone";
  if (service === "db") service = "postgres";
  if (service === "queue") service = "redis";
  if (["postgres", "redis", "agent", "pinecone", "groq"].includes(service)) {
    if (["unknown", "checking", "ok", "down"].includes(status)) {
      serviceRegistry[service] = status;
    }
  }
  res.json({ ok: true });
});
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
startHealthChecks();

app.listen(config.port, () => {
  logger.info({ port: config.port }, "CodeReviewAI API listening");
});
