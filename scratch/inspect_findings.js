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
  console.log("=== All Reviews ===");
  const reviews = await pool.query(`
    select r.id, r.pull_request_id, r.queue_job_id, r.status, r.completed_at, pr.number, pr.head_sha
    from reviews r
    join pull_requests pr on pr.id = r.pull_request_id
    order by r.id desc
    limit 10
  `);
  console.log(reviews.rows);

  console.log("=== Findings for the last few reviews ===");
  const findings = await pool.query(`
    select f.id, f.review_id, f.path, f.title
    from findings f
    order by f.review_id desc, f.id desc
    limit 30
  `);
  console.log(findings.rows);

  await pool.end();
}

main().catch(console.error);
