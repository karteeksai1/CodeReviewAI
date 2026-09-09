import argparse
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
load_dotenv()

EVAL_REPO_FULL_NAME = "local/eval-dataset"
EVAL_REPO_OWNER = "local"
EVAL_REPO_NAME = "eval-dataset"
EVAL_PR_NUMBER = 0
EVAL_PR_TITLE = "Local Evaluation Run"
EVAL_HEAD_SHA = "eval-local"
EVAL_BASE_SHA = "eval-local"
AGENT_URL = os.environ.get("AGENT_URL", "http://127.0.0.1:8000")
DB_INDEX_PATH = ROOT / "apps" / "api" / "src" / "db" / "index.js"

SUPPORTED_EXTENSIONS = {".py", ".js", ".ts", ".jsx", ".tsx"}


def _node_query(sql, params=None):
    params_json = json.dumps(params or [])
    node_code = f"""
import {{ query }} from {json.dumps(DB_INDEX_PATH.as_posix())};
const res = await query({json.dumps(sql)}, {params_json});
process.stdout.write(JSON.stringify(res.rows));
process.exit(0);
"""
    env = dict(os.environ)
    env["NODE_NO_WARNINGS"] = "1"
    result = subprocess.run(
        ["node", "--input-type=module", "-e", node_code],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    if result.returncode != 0:
        raise RuntimeError(f"DB query failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def ensure_eval_repo_and_pr():
    users = _node_query("select id from users where email = $1", ["admin@codereviewai.local"])
    user_id = users[0]["id"] if users else None

    existing_repo = _node_query(
        "select id from repositories where full_name = $1",
        [EVAL_REPO_FULL_NAME],
    )
    if existing_repo:
        repo_id = existing_repo[0]["id"]
    else:
        rows = _node_query(
            """
            insert into repositories (github_id, owner, name, full_name, installation_id, default_branch, user_id)
            values (0, $1, $2, $3, null, 'main', $4)
            on conflict (full_name) do update set updated_at = now()
            returning id
            """,
            [EVAL_REPO_OWNER, EVAL_REPO_NAME, EVAL_REPO_FULL_NAME, user_id],
        )
        repo_id = rows[0]["id"]

    existing_pr = _node_query(
        "select id from pull_requests where repository_id = $1 and number = $2",
        [repo_id, EVAL_PR_NUMBER],
    )
    if existing_pr:
        pr_id = existing_pr[0]["id"]
    else:
        rows = _node_query(
            """
            insert into pull_requests (repository_id, github_id, number, title, head_sha, base_sha, is_draft, state)
            values ($1, 0, $2, $3, $4, $5, false, 'open')
            on conflict (repository_id, number) do update set updated_at = now()
            returning id
            """,
            [repo_id, EVAL_PR_NUMBER, EVAL_PR_TITLE, EVAL_HEAD_SHA, EVAL_BASE_SHA],
        )
        pr_id = rows[0]["id"]

    return pr_id


def create_eval_review(pr_id):
    rows = _node_query(
        """
        insert into reviews (pull_request_id, queue_job_id, status, head_sha, base_sha, started_at)
        values ($1, $2, 'in_progress', $3, $4, now())
        returning id
        """,
        [pr_id, f"eval-{EVAL_HEAD_SHA}", EVAL_HEAD_SHA, EVAL_BASE_SHA],
    )
    return rows[0]["id"]


def finalize_review(review_id, finding_count):
    _node_query(
        "update reviews set status = 'completed', completed_at = now(), summary = $2, risk_score = $3 where id = $1",
        [review_id, f"Local evaluation completed. {finding_count} finding(s) generated.", 0],
    )


def fail_review(review_id, error_msg):
    _node_query(
        "update reviews set status = 'failed', completed_at = now(), error = $2 where id = $1",
        [review_id, error_msg[:500]],
    )


def insert_findings_for_review(review_id, findings):
    inserted = 0
    for f in findings:
        try:
            _node_query(
                """
                insert into findings (review_id, category, severity, title, body, path, line, confidence, metadata)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
                on conflict (review_id, category, severity, (coalesce(path, '')), (coalesce(line, 0)), title) do nothing
                """,
                [
                    review_id,
                    f.get("category", "style"),
                    f.get("severity", "info"),
                    (f.get("title") or "finding")[:512],
                    f.get("body") or "",
                    f.get("path"),
                    f.get("line"),
                    float(f.get("confidence") or 0.7),
                    json.dumps(f.get("metadata") or {}),
                ],
            )
            inserted += 1
        except Exception as e:
            print(f"  [warn] could not insert finding '{f.get('title', '')[:60]}': {e}", file=sys.stderr)
    return inserted


def build_file_patch(content, path):
    lines = content.splitlines()
    hunk_header = f"@@ -0,0 +1,{len(lines)} @@"
    patch_lines = [f"+{line}" for line in lines]
    return "\n".join([hunk_header] + patch_lines)


async def call_agent(file_patches, timeout_seconds=300.0):
    import httpx

    payload = {
        "repository": {
            "owner": EVAL_REPO_OWNER,
            "name": EVAL_REPO_NAME,
            "fullName": EVAL_REPO_FULL_NAME,
        },
        "pullRequest": {
            "id": 0,
            "number": EVAL_PR_NUMBER,
            "title": EVAL_PR_TITLE,
            "headSha": EVAL_HEAD_SHA,
            "baseSha": EVAL_BASE_SHA,
        },
        "files": file_patches,
        "diff": "",
    }
    timeout = httpx.Timeout(timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(f"{AGENT_URL}/review", json=payload)
        if response.status_code != 200:
            raise RuntimeError(f"Agent HTTP {response.status_code}: {response.text}")
        return response.json()


def check_agent_health():
    import urllib.request
    try:
        with urllib.request.urlopen(f"{AGENT_URL}/health", timeout=5) as r:
            return r.status == 200
    except Exception:
        return False


def collect_eval_files(dataset_dir):
    dataset_path = Path(dataset_dir).resolve()
    files = []
    for ext in SUPPORTED_EXTENSIONS:
        for f in dataset_path.rglob(f"*{ext}"):
            if f.is_file():
                files.append(f)
    return sorted(files)


def file_to_relative_path(filepath, dataset_dir):
    dataset_path = Path(dataset_dir).resolve()
    rel = filepath.relative_to(dataset_path)
    return str(rel).replace("\\", "/")


def normalize_category(category):
    cat = str(category or "").lower().strip()
    mapping = {"bug": "bug", "bugs": "bug", "correctness": "bug", "logic": "bug",
               "security": "security", "performance": "performance", "style": "style"}
    return mapping.get(cat, cat)


async def run_eval(dataset_dir, batch_size, verbose):
    import httpx
    if not check_agent_health():
        print(f"ERROR: Agent not reachable at {AGENT_URL}. Start it with:", file=sys.stderr)
        print(f"  cd apps/agent && uvicorn main:app --host 127.0.0.1 --port 8000", file=sys.stderr)
        sys.exit(1)

    eval_files = collect_eval_files(dataset_dir)
    if not eval_files:
        print(f"No supported files found under {dataset_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(eval_files)} evaluation file(s) under {dataset_dir}")
    print(f"Agent URL: {AGENT_URL}")

    pr_id = ensure_eval_repo_and_pr()
    review_id = create_eval_review(pr_id)
    print(f"Created evaluation review (ID: {review_id})")

    successes = []
    failures = []
    all_findings = []

    batches = [eval_files[i:i + batch_size] for i in range(0, len(eval_files), batch_size)]

    for batch_idx, batch in enumerate(batches):
        file_patches = []
        batch_paths = []

        for filepath in batch:
            rel_path = file_to_relative_path(filepath, dataset_dir)
            try:
                content = filepath.read_text(encoding="utf-8", errors="replace")
            except Exception as e:
                failures.append((rel_path, str(e)))
                print(f"  [fail] read error: {rel_path}: {e}", file=sys.stderr)
                continue

            patch = build_file_patch(content, rel_path)
            file_patches.append({
                "path": rel_path,
                "status": "added",
                "additions": len(content.splitlines()),
                "deletions": 0,
                "changes": len(content.splitlines()),
                "patch": patch,
                "content": content,
            })
            batch_paths.append(rel_path)

        if not file_patches:
            continue

        if verbose:
            print(f"\nBatch {batch_idx + 1}/{len(batches)}: {[p for p in batch_paths]}")

        try:
            result = await call_agent(file_patches, timeout_seconds=300.0)
            raw_findings = result.get("findings", [])

            for f in raw_findings:
                f["category"] = normalize_category(f.get("category", "style"))
                if len(batch_paths) == 1:
                    f["path"] = batch_paths[0]
                elif not f.get("path") or f.get("path") not in batch_paths:
                    for bp in batch_paths:
                        if bp.endswith(str(f.get("path", ""))):
                            f["path"] = bp
                            break

            batch_inserted = insert_findings_for_review(review_id, raw_findings)
            all_findings.extend(raw_findings)
            successes.extend(batch_paths)

            if verbose:
                print(f"  -> {len(raw_findings)} finding(s), {batch_inserted} inserted into DB")
            else:
                for p in batch_paths:
                    print(f"  [ok] {p}")

        except Exception as e:
            if len(file_patches) > 1:
                print(f"  [warn] Batch failed ({e}). Retrying {len(file_patches)} files individually...", file=sys.stderr)
                for single_patch, single_path in zip(file_patches, batch_paths):
                    try:
                        single_res = await call_agent([single_patch], timeout_seconds=180.0)
                        single_findings = single_res.get("findings", [])
                        for f in single_findings:
                            f["category"] = normalize_category(f.get("category", "style"))
                            f["path"] = single_path
                        insert_findings_for_review(review_id, single_findings)
                        all_findings.extend(single_findings)
                        successes.append(single_path)
                        print(f"  [ok] {single_path}")
                    except httpx.HTTPStatusError as se:
                        err_msg = f"HTTP {se.response.status_code}: {se.response.text}"
                        failures.append((single_path, err_msg))
                        print(f"  [fail] {single_path}: {err_msg}", file=sys.stderr)
                    except httpx.TimeoutException as se:
                        err_msg = f"Timeout (180s): {se}"
                        failures.append((single_path, err_msg))
                        print(f"  [fail] {single_path}: {err_msg}", file=sys.stderr)
                    except Exception as se:
                        import traceback
                        err_msg = f"{type(se).__name__}: {se}\n{traceback.format_exc()}"
                        failures.append((single_path, err_msg))
                        print(f"  [fail] {single_path}:\n{err_msg}", file=sys.stderr)
            else:
                p = batch_paths[0]
                if isinstance(e, httpx.HTTPStatusError):
                    err_msg = f"HTTP {e.response.status_code}: {e.response.text}"
                elif isinstance(e, httpx.TimeoutException):
                    err_msg = f"Timeout (300s): {e}"
                else:
                    import traceback
                    err_msg = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
                failures.append((p, err_msg))
                print(f"  [fail] agent error on {p}:\n{err_msg}", file=sys.stderr)

        await asyncio.sleep(0.5)

    finalize_review(review_id, len(all_findings))

    print()
    print("=" * 50)
    print("Evaluation completed.")
    print(f"Files reviewed    : {len(successes)}")
    print(f"Files failed      : {len(failures)}")
    print(f"Review ID         : {review_id}")
    print(f"Findings generated: {len(all_findings)}")
    print("=" * 50)

    if failures:
        print("\nFailed files:")
        for path, reason in failures:
            print(f"  - {path}: {reason}")

    print(f"\nTo evaluate against ground truth:")
    print(f"  python evals/evaluate.py --review-id {review_id}")

    return review_id


def main():
    parser = argparse.ArgumentParser(
        description="Run CodeReviewAI against the local evaluation dataset and store findings in Neon PostgreSQL."
    )
    parser.add_argument(
        "--dataset",
        default="evals/datasets",
        help="Path to the eval dataset directory (default: evals/datasets)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
        help="Number of files to send to the agent per request (default: 1)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print per-batch detail",
    )
    args = parser.parse_args()

    dataset_dir = Path(args.dataset)
    if not dataset_dir.exists():
        print(f"ERROR: Dataset directory not found: {dataset_dir}", file=sys.stderr)
        sys.exit(1)

    asyncio.run(run_eval(str(dataset_dir), args.batch_size, args.verbose))


if __name__ == "__main__":
    main()
