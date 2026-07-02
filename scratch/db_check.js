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
  const result = await pool.query("select id, repository_full_name, status, message, chunks, embedded from indexing_jobs where id = '38'");
  console.log(result.rows);
  await pool.end();
}

main().catch(console.error);
