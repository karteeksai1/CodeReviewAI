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
  console.log("=== Review IDs for pull request 5 ===");
  const reviews = await pool.query(`
    select r.id, r.pull_request_id, r.status, pr.number, pr.head_sha
    from reviews r
    join pull_requests pr on pr.id = r.pull_request_id
    where pr.number = 5
  `);
  console.log(reviews.rows);

  for (const row of reviews.rows) {
    console.log(`=== Findings for Review ID ${row.id} ===`);
    const findings = await pool.query(`
      select id, path, title, line, severity
      from findings
      where review_id = $1
    `, [row.id]);
    console.log(findings.rows);
  }

  await pool.end();
}

main().catch(console.error);
