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
  const latestRev = await pool.query("select * from reviews order by id desc limit 1");
  const review = latestRev.rows[0];
  console.log("Latest Review:", {
    id: review.id,
    status: review.status,
    head_sha: review.head_sha
  });
  
  const findings = await pool.query("select * from findings where review_id = $1", [review.id]);
  console.log("Canonical findings count:", findings.rows.length);

  const agentRuns = await pool.query("select * from agent_runs where review_id = $1", [review.id]);
  console.log("Agent runs stored in DB:");
  console.log(agentRuns.rows);
  
  const sumRuns = agentRuns.rows.reduce((sum, run) => sum + (run.finding_count || 0), 0);
  console.log("Sum of agent runs findings:", sumRuns);

  await pool.end();
}

main().catch(console.error);
