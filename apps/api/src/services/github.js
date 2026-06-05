import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

function assertGitHubConfig() {
  if (!config.github.appId || !config.github.privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required");
  }
}

export async function getInstallationOctokit(installationId) {
  assertGitHubConfig();
  const auth = createAppAuth({ appId: config.github.appId, privateKey: config.github.privateKey, installationId });
  const installationAuth = await auth({ type: "installation" });
  return new Octokit({ auth: installationAuth.token });
}

export async function fetchPullRequestContext({ owner, repo, pullNumber, installationId }) {
  const octokit = await getInstallationOctokit(installationId);
  const [{ data: pullRequest }, { data: files }, diffResponse] = await Promise.all([
    octokit.pulls.get({ owner, repo, pull_number: pullNumber }),
    octokit.pulls.listFiles({ owner, repo, pull_number: pullNumber, per_page: 100 }),
    octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner,
      repo,
      pull_number: pullNumber,
      headers: { accept: "application/vnd.github.v3.diff" }
    })
  ]);
  return {
    repository: { owner, name: repo, fullName: `${owner}/${repo}` },
    pullRequest: {
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      body: pullRequest.body,
      author: pullRequest.user?.login,
      baseSha: pullRequest.base.sha,
      headSha: pullRequest.head.sha,
      isDraft: pullRequest.draft,
      url: pullRequest.html_url
    },
    files: files.map((file) => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes, patch: file.patch ?? "" })),
    diff: String(diffResponse.data ?? "")
  };
}

export async function postReviewSummary({ owner, repo, pullNumber, installationId, headSha, summary, findings }) {
  if (!config.github.postComments) return false;
  const octokit = await getInstallationOctokit(installationId);
  const comments = findings.filter((finding) => finding.path && finding.line).slice(0, 20).map((finding) => ({
    path: finding.path,
    line: Number(finding.line),
    side: "RIGHT",
    body: `**${finding.severity.toUpperCase()} ${finding.category}**: ${finding.title}\n\n${finding.body}`
  }));
  const body = renderReviewBody(summary, findings);
  if (comments.length && headSha) {
    await octokit.pulls.createReview({ owner, repo, pull_number: pullNumber, commit_id: headSha, event: "COMMENT", body, comments });
    return true;
  }
  await octokit.issues.createComment({ owner, repo, issue_number: pullNumber, body });
  return true;
}

function renderReviewBody(summary, findings) {
  const top = findings.slice(0, 10).map((finding) => `- **${finding.severity} / ${finding.category}**: ${finding.title}`).join("\n");
  return ["## CodeReviewAI review", "", summary || "Review complete.", "", top || "No actionable findings were detected."].join("\n");
}
