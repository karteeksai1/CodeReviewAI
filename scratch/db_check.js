import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const rootEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
dotenv.config({ path: rootEnvPath });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log("=== Users ===");
  const users = await pool.query("select id, email from users");
  console.log(users.rows);

  console.log("=== Repositories ===");
  const repos = await pool.query("select id, owner, name, full_name, installation_id, user_id from repositories");
  console.log(repos.rows);

  console.log("=== Pull Requests ===");
  const prs = await pool.query("select id, repository_id, github_id, number, title, head_sha, state from pull_requests");
  console.log(prs.rows);

  console.log("=== Reviews ===");
  const reviews = await pool.query("select r.id, r.pull_request_id, r.queue_job_id, r.status, r.summary, r.error from reviews r");
  console.log(reviews.rows);

  await pool.end();
}

main().catch(console.error);
