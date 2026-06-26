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
  const [{ data: initialPr }, { data: files }, diffResponse] = await Promise.all([
    octokit.pulls.get({ owner, repo, pull_number: pullNumber }),
    octokit.pulls.listFiles({ owner, repo, pull_number: pullNumber, per_page: 100 }),
    octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner,
      repo,
      pull_number: pullNumber,
      headers: { accept: "application/vnd.github.v3.diff" }
    })
  ]);
  let pullRequest = initialPr;
  let mergeable = pullRequest.mergeable;
  let mergeableState = pullRequest.mergeable_state;
  if (mergeable === null || mergeable === undefined) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const res = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });
      pullRequest = res.data;
      mergeable = pullRequest.mergeable;
      mergeableState = pullRequest.mergeable_state;
      if (mergeable !== null && mergeable !== undefined) {
        break;
      }
    }
  }
  let conflictDetails = null;
  if (mergeable === false || mergeableState === "dirty") {
    try {
      const compareRes = await octokit.repos.compareCommits({
        owner,
        repo,
        base: pullRequest.base.ref,
        head: pullRequest.head.sha
      });
      const mergeBaseSha = compareRes.data.merge_base_commit?.sha;
      if (mergeBaseSha && mergeBaseSha !== pullRequest.base.sha) {
        const baseCompareRes = await octokit.repos.compareCommits({
          owner,
          repo,
          base: mergeBaseSha,
          head: pullRequest.base.ref
        });
        const prFileNames = files.map((file) => file.filename);
        const baseFileNames = baseCompareRes.data.files?.map((file) => file.filename) || [];
        const intersected = prFileNames.filter((file) => baseFileNames.includes(file));
        if (intersected.length > 0) {
          conflictDetails = intersected.join(", ");
        }
      }
    } catch (err) {
    }
  }
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
      url: pullRequest.html_url,
      mergeable,
      mergeableState,
      conflictDetails
    },
    files: files.map((file) => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes, patch: file.patch ?? "" })),
    diff: String(diffResponse.data ?? "")
  };
}

export function getValidDiffLines(patch) {
  const validLines = new Set();
  if (!patch) return validLines;
  const lines = patch.split("\n");
  let currentNewLine = null;
  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    const hunkHeaderMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkHeaderMatch) {
      currentNewLine = parseInt(hunkHeaderMatch[1], 10);
      continue;
    }
    if (currentNewLine !== null) {
      if (line.startsWith("+") || line.startsWith(" ")) {
        validLines.add(currentNewLine);
        currentNewLine++;
      } else if (line.startsWith("-")) {
        // deletion
      }
    }
  }
  return validLines;
}

export async function postReviewSummary({ owner, repo, pullNumber, installationId, headSha, summary, findings, files = [] }) {
  if (!config.github.postComments) return false;
  const octokit = await getInstallationOctokit(installationId);
  const filesMap = new Map();
  if (files && files.length > 0) {
    for (const f of files) {
      filesMap.set(f.path, getValidDiffLines(f.patch));
    }
  }
  const comments = [];
  const summaryOnlyFindings = [];
  for (const finding of findings) {
    if (!finding.path || !finding.line) {
      summaryOnlyFindings.push(finding);
      continue;
    }
    const validLines = filesMap.get(finding.path);
    const lineNum = Number(finding.line);
    if (validLines && validLines.has(lineNum)) {
      comments.push({
        path: finding.path,
        line: lineNum,
        side: "RIGHT",
        body: `**${finding.severity.toUpperCase()} ${finding.category}**: ${finding.title}\n\n${finding.body}`
      });
    } else {
      summaryOnlyFindings.push(finding);
    }
  }
  const finalComments = comments.slice(0, 20);
  const extraInline = comments.slice(20);
  summaryOnlyFindings.push(...extraInline);
  const body = renderReviewBody(summary, findings, summaryOnlyFindings);
  if (finalComments.length && headSha) {
    await octokit.pulls.createReview({ owner, repo, pull_number: pullNumber, commit_id: headSha, event: "COMMENT", body, comments: finalComments });
    return true;
  }
  await octokit.issues.createComment({ owner, repo, issue_number: pullNumber, body });
  return true;
}

function renderReviewBody(summary, findings, summaryOnlyFindings = []) {
  const top = findings.slice(0, 10).map((finding) => `- **${finding.severity} / ${finding.category}**: ${finding.title}`).join("\n");
  let bodySections = [
    "## CodeReviewAI review",
    "",
    summary || "Review complete.",
    "",
    top || "No actionable findings were detected."
  ];
  if (summaryOnlyFindings.length > 0) {
    const additional = summaryOnlyFindings.map((finding) => {
      const loc = finding.path ? ` at ${finding.path}:${finding.line}` : "";
      return `### **${finding.severity.toUpperCase()} ${finding.category}**${loc}: ${finding.title}\n\n${finding.body}`;
    }).join("\n\n");
    bodySections.push("", "### Additional Findings (outside changed lines)", "", additional);
  }
  return bodySections.join("\n");
}
