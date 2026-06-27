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
  const queryText = `
    SELECT 
      r.id, 
      rep.full_name AS repo_name, 
      pr.number AS pr_number, 
      r.head_sha AS commit_sha, 
      r.status, 
      r.summary, 
      r.created_at
    FROM reviews r
    JOIN pull_requests pr ON pr.id = r.pull_request_id
    JOIN repositories rep ON rep.id = pr.repository_id
    ORDER BY r.created_at DESC
    LIMIT 15
  `;
  const reviews = await pool.query(queryText);
  console.log(reviews.rows);
  await pool.end();
}

main().catch(console.error);
