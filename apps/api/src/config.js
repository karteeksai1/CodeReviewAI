import dotenv from "dotenv";

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  databaseUrl: process.env.DATABASE_URL,
  autoMigrate: process.env.DB_AUTO_MIGRATE !== "false",
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY ?? 3),
  agentUrl: process.env.AGENT_URL ?? "http://localhost:8000",
  github: {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    postComments: process.env.GITHUB_POST_COMMENTS !== "false"
  }
};
