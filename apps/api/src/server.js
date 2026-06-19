import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { initDb } from "./db/index.js";
import { authRouter } from "./routes/auth.js";
import { reviewsRouter } from "./routes/reviews.js";
import { webhookRouter } from "./routes/webhook.js";
import { logger } from "./logger.js";

const app = express();

app.use(cors());
app.get("/health", (_req, res) => res.json({ ok: true, service: "api" }));
app.use("/webhook", webhookRouter);
app.use(express.json({ limit: "2mb" }));
app.use("/auth", authRouter);
app.use("/reviews", reviewsRouter);

app.use((err, _req, res, _next) => {
  logger.error({ err }, "request failed");
  res.status(err.statusCode ?? 500).json({ error: err.message ?? "Internal server error" });
});

await initDb();

app.listen(config.port, () => {
  logger.info({ port: config.port }, "CodeReviewAI API listening");
});
