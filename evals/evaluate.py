import argparse
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

CATEGORY_MAP = {
    "BUGS": "BUG",
    "CORRECTNESS": "BUG",
    "LOGIC": "BUG",
    "RUNTIME": "BUG",
    "ERROR": "BUG",
}

def norm(value):
    return " ".join(str(value).lower().split())

def normalize_file_path(path_str):
    if not path_str:
        return ""
    p = str(path_str).split(":")[0].strip().replace("\\", "/")
    for prefix in [
        "evals/code_review_eval_dataset/datasets/",
        "code_review_eval_dataset/datasets/",
        "evals/datasets/",
        "datasets/",
        "evals/",
    ]:
        if p.startswith(prefix):
            p = p[len(prefix):]
            break
    if "python/" in p:
        p = "python/" + p.split("python/", 1)[1]
    elif "javascript/" in p:
        p = "javascript/" + p.split("javascript/", 1)[1]
    return p

def normalize_category(cat):
    c = str(cat or "").upper().strip()
    return CATEGORY_MAP.get(c, c)

def get_word_overlap(gt_text, pred_text):
    gt_words = {w.strip(".,;:()[]{}\"'`") for w in norm(gt_text).split() if len(w.strip(".,;:()[]{}\"'`")) >= 4}
    pred_words = {w.strip(".,;:()[]{}\"'`") for w in norm(pred_text).split() if len(w.strip(".,;:()[]{}\"'`")) >= 4}
    return len(gt_words & pred_words) / max(1, len(gt_words))

def match(gt, pred):
    if normalize_file_path(gt.get("file", "")) != normalize_file_path(pred.get("file", "")):
        return False
    if normalize_category(gt.get("category", "")) != normalize_category(pred.get("category", "")):
        return False

    gt_line = int(gt.get("line", 0) or 0)
    pred_line = int(pred.get("line", 0) or 0)
    line_close = abs(gt_line - pred_line) <= 3

    overlap = get_word_overlap(gt.get("description", ""), pred.get("description", ""))
    return line_close or overlap >= 0.30

def load_file(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "findings" in data:
        return data["findings"]
    if isinstance(data, list):
        return data
    return []

def format_db_findings(raw_rows):
    formatted = []
    for row in raw_rows:
        title = (row.get("title") or "").strip()
        body = (row.get("body") or "").strip()
        if title and body:
            desc = f"{title}: {body}"
        else:
            desc = title or body
        formatted.append({
            "file": normalize_file_path(row.get("path")),
            "line": int(row.get("line") or 0),
            "category": normalize_category(row.get("category")),
            "severity": str(row.get("severity") or "").upper().strip(),
            "description": desc
        })
    return formatted

def fetch_findings_from_db(review_id):
    repo_root = Path(__file__).resolve().parent.parent
    db_index_path = repo_root / "apps" / "api" / "src" / "db" / "index.js"

    database_url = os.environ.get("NEON_DATABASE_URL") or os.environ.get("DATABASE_URL")

    try:
        import psycopg2
        import psycopg2.extras
        if database_url:
            conn = psycopg2.connect(database_url)
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT * FROM findings WHERE review_id = %s ORDER BY id ASC", (int(review_id),))
            rows = cur.fetchall()
            cur.close()
            conn.close()
            return [dict(r) for r in rows]
    except ImportError:
        pass

    try:
        import psycopg
        from psycopg.rows import dict_row
        if database_url:
            with psycopg.connect(database_url, row_factory=dict_row) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM findings WHERE review_id = %s ORDER BY id ASC", (int(review_id),))
                    rows = cur.fetchall()
                    return [dict(r) for r in rows]
    except ImportError:
        pass

    node_code = f"""
import {{ query }} from {json.dumps(db_index_path.as_posix())};
const res = await query('select * from findings where review_id = $1 order by id asc', [{int(review_id)}]);
process.stdout.write(JSON.stringify(res.rows));
process.exit(0);
"""
    env = dict(os.environ)
    env["NODE_NO_WARNINGS"] = "1"
    res = subprocess.run(
        ["node", "--input-type=module", "-e", node_code],
        cwd=str(repo_root),
        env=env,
        capture_output=True,
        text=True
    )
    if res.returncode != 0:
        sys.stderr.write(res.stderr)
        raise RuntimeError(f"Node database query failed with exit code {res.returncode}")

    return json.loads(res.stdout)

def evaluate(gt, pred):
    remaining = list(gt)
    matched = []
    false_positive = []

    for p in pred:
        candidates = []
        for g in remaining:
            if match(g, p):
                diff = abs(int(g.get("line", 0) or 0) - int(p.get("line", 0) or 0))
                overlap = get_word_overlap(g.get("description", ""), p.get("description", ""))
                candidates.append((diff, -overlap, g))
        if not candidates:
            false_positive.append(p)
        else:
            candidates.sort(key=lambda x: (x[0], x[1]))
            hit = candidates[0][2]
            matched.append((hit, p))
            remaining.remove(hit)

    false_negative = remaining
    tp = len(matched)
    fp = len(false_positive)
    fn = len(false_negative)

    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if precision + recall else 0.0
    severity_ok = sum(norm(g.get("severity", "")) == norm(p.get("severity", "")) for g, p in matched)
    severity_accuracy = severity_ok / tp if tp else 0.0

    print("CODE REVIEW EVALUATION")
    print("=" * 28)
    print(f"Ground truth findings : {len(gt)}")
    print(f"Predicted findings    : {len(pred)}")
    print(f"True positives        : {tp}")
    print(f"False positives       : {fp}")
    print(f"False negatives       : {fn}")
    print(f"Precision             : {precision:.2%}")
    print(f"Recall                : {recall:.2%}")
    print(f"F1                    : {f1:.2%}")
    print(f"Severity accuracy     : {severity_accuracy:.2%}")

    counts = Counter(normalize_category(g.get("category", "")) for g in gt)
    hits = Counter(normalize_category(g.get("category", "")) for g, _ in matched)
    print("\nRecall by category")
    for category in sorted(counts):
        hit_count = hits[category]
        total_count = counts[category]
        ratio = hit_count / total_count if total_count else 0.0
        print(f"{category:12} {hit_count}/{total_count} ({ratio:.2%})")

    if false_positive:
        print("\nFalse positives")
        for p in false_positive:
            print(f"- {p.get('file')}:{p.get('line')} {p.get('category')} {p.get('description')}")

    if false_negative:
        print("\nFalse negatives")
        for g in false_negative:
            print(f"- {g.get('file')}:{g.get('line')} {g.get('category')} {g.get('description')}")

    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "severity_accuracy": severity_accuracy
    }

def main():
    parser = argparse.ArgumentParser(description="Evaluate CodeReviewAI predictions against ground truth")
    parser.add_argument("predictions_file", nargs="?", default=None, help="Path to predictions JSON file")
    parser.add_argument("--predictions", dest="predictions_opt", default=None, help="Path to predictions JSON file")
    parser.add_argument("--review-id", type=int, default=None, help="Review ID to fetch from Neon PostgreSQL")
    parser.add_argument("--ground-truth", default=None, help="Path to ground_truth.json")
    parser.add_argument("--save-predictions", default=None, help="Path to save converted predictions JSON")

    args = parser.parse_args()

    evals_dir = Path(__file__).resolve().parent
    gt_path = Path(args.ground_truth) if args.ground_truth else evals_dir / "ground_truth.json"
    if not gt_path.exists():
        gt_path = Path("ground_truth.json")
    if not gt_path.exists():
        raise FileNotFoundError(f"Ground truth file not found at {gt_path}")

    gt = load_file(str(gt_path))

    pred_path = args.predictions_opt or args.predictions_file
    save_path = args.save_predictions

    if args.review_id is not None:
        raw_rows = fetch_findings_from_db(args.review_id)
        pred = format_db_findings(raw_rows)
        target_save = save_path or str(evals_dir / "predictions.json")
        with open(target_save, "w", encoding="utf-8") as f:
            json.dump({"findings": pred}, f, indent=2)
    elif pred_path:
        pred_file = Path(pred_path)
        if not pred_file.exists():
            raise FileNotFoundError(f"Predictions file not found at {pred_file}")
        raw_pred = load_file(str(pred_file))
        pred = [
            {
                "file": normalize_file_path(p.get("file") or p.get("path")),
                "line": int(p.get("line") or 0),
                "category": normalize_category(p.get("category")),
                "severity": str(p.get("severity") or "").upper().strip(),
                "description": p.get("description") or f"{p.get('title', '')}: {p.get('body', '')}".strip(": ")
            }
            for p in raw_pred
        ]
        if save_path:
            with open(save_path, "w", encoding="utf-8") as f:
                json.dump({"findings": pred}, f, indent=2)
    else:
        default_pred = evals_dir / "predictions.json"
        if default_pred.exists():
            raw_pred = load_file(str(default_pred))
            pred = [
                {
                    "file": normalize_file_path(p.get("file") or p.get("path")),
                    "line": int(p.get("line") or 0),
                    "category": normalize_category(p.get("category")),
                    "severity": str(p.get("severity") or "").upper().strip(),
                    "description": p.get("description") or f"{p.get('title', '')}: {p.get('body', '')}".strip(": ")
                }
                for p in raw_pred
            ]
        else:
            parser.print_help()
            sys.exit(1)

    evaluate(gt, pred)

if __name__ == "__main__":
    main()
