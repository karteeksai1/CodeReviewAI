import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool({
  connectionString: config.databaseUrl
});

async function main() {
  const res = await pool.query(`
    select r.id, r.status, r.error, r.queue_job_id, pr.number, pr.title, repo.full_name as repo_name
    from reviews r
    left join pull_requests pr on r.pull_request_id = pr.id
    left join repositories repo on pr.repository_id = repo.id
    where r.status = 'failed' or r.error is not null
    order by r.created_at desc
    limit 5
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await pool.end();
}

main().catch(console.error);
