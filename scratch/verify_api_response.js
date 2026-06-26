import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const rootEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
dotenv.config({ path: rootEnvPath });

async function main() {
  const loginRes = await fetch("http://localhost:3001/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "temp-qa-tester@codereviewai.local",
      password: "Password123!"
    })
  });
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const { token } = await loginRes.json();

  console.log("=== GET /reviews/pr ===");
  const params = new URLSearchParams({ owner: "mockowner", repo: "mock-repo", number: "1" });
  const prRes = await fetch(`http://localhost:3001/reviews/pr?${params}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!prRes.ok) {
    throw new Error(`PR lookup failed: ${prRes.status} ${await prRes.text()}`);
  }
  const prData = await prRes.json();
  console.log("Reviews count returned:", prData.reviews.length);
  if (prData.reviews.length > 0) {
    const review = prData.reviews[0];
    console.log("Latest Review Info:", {
      id: review.id,
      status: review.status,
      risk_score: review.risk_score,
      mergeable: review.mergeable,
      mergeable_state: review.mergeable_state,
      conflict_details: review.conflict_details,
      head_sha: review.head_sha,
      base_sha: review.base_sha,
      findingsCount: review.findings?.length
    });

    console.log("=== GET /reviews/:id ===");
    const detailRes = await fetch(`http://localhost:3001/reviews/${review.id}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!detailRes.ok) {
      throw new Error(`Review detail failed: ${detailRes.status} ${await detailRes.text()}`);
    }
    const detailData = await detailRes.json();
    console.log("Detail Review Info:", {
      id: detailData.review.id,
      status: detailData.review.status,
      risk_score: detailData.review.risk_score,
      mergeable: detailData.review.mergeable,
      mergeable_state: detailData.review.mergeable_state,
      conflict_details: detailData.review.conflict_details,
      head_sha: detailData.review.head_sha,
      base_sha: detailData.review.base_sha,
      findingsCount: detailData.review.findings?.length,
      agentRunsCount: detailData.review.agent_runs?.length
    });
  }

  console.log("Verification finished successfully.");
}

main().catch(console.error);
