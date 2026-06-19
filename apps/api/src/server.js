import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { initDb } from "./db/index.js";
import { authRouter } from "./routes/auth.js";
import { reviewsRouter } from "./routes/reviews.js";
import { webhookRouter } from "./routes/webhook.js";
import { logger } from "./logger.js";
import { publicError } from "./errors.js";

const app = express();

app.use(cors());
app.get("/health", (_req, res) => res.json({ ok: true, service: "api" }));
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

app.use((err, _req, res, _next) => {
  logger.error({ err }, "request failed");
  const { statusCode, message } = publicError(err);
  res.status(statusCode).json({ error: message });
});

await initDb();

app.listen(config.port, () => {
  logger.info({ port: config.port }, "CodeReviewAI API listening");
});
