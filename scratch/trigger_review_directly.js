import pg from 'pg';
import { fetchPullRequestContext } from '../apps/api/src/services/github.js';
import { requestAgentReview } from '../apps/api/src/services/agent-bridge.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const rootEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
dotenv.config({ path: rootEnvPath });

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const repoRes = await client.query("select * from repositories where id = 12");
  const repo = repoRes.rows[0];
  console.log("Repo info:", repo);

  const context = await fetchPullRequestContext({
    owner: repo.owner,
    repo: repo.name,
    pullNumber: 13,
    installationId: Number(repo.installation_id)
  });

  console.log("Sending context to agent...");
  try {
    const res = await requestAgentReview(context, "test-request-id");
    console.log("=== AGENT REVIEW RESPONSE ===");
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Agent call failed:", err);
  }

  await client.end();
}

main().catch(console.error);
