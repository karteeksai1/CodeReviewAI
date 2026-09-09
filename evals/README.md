# Code Review Evaluation Dataset

A 30-file benchmark for an LLM-based code review system.

## Dataset composition

- 15 Python files
- 15 JavaScript/TypeScript files
- 6 clean files for false-positive testing
- Faulty cases covering BUG, SECURITY, PERFORMANCE, and STYLE
- Mixed cases containing multiple categories
- Ground-truth finding metadata with file, category, severity, line, and description

The credentials in the test files are deliberately fake and exist only to exercise security detection.

## Layout

```text
evals/
├── datasets/
│   ├── python/
│   └── javascript/
├── ground_truth.json
├── predictions.json
├── evaluate.py
└── README.md
```

## How to Obtain a review_id

To evaluate an automated review run executed by the CodeReviewAI pipeline:

1. **Via Dashboard UI**: Navigate to the Reviews tab in the web dashboard. Selecting any review run displays its details and review ID.
2. **Via Neon PostgreSQL Database**:
   Run the following query in your database client or psql:
   ```sql
   SELECT id, pull_request_id, status, risk_score, created_at
   FROM reviews
   ORDER BY id DESC
   LIMIT 10;
   ```
3. **Via API logs**: The worker outputs review IDs upon review completion.

## Local Evaluation Workflow (No GitHub Required)

This is the recommended way to benchmark the review agents against the full 30-file dataset and measure precision/recall.

### Prerequisites

The FastAPI agent must be running locally before starting an evaluation:

```bash
cd apps/agent
uvicorn main:app --host 127.0.0.1 --port 8000
```

A `DATABASE_URL` or `NEON_DATABASE_URL` must be set in `.env` at the project root.

---

### Step 1 — Run the evaluation

```bash
python evals/run_eval.py --dataset evals/datasets/
```

This command:
- Recursively discovers all `.py`, `.js`, and `.ts` files under `evals/datasets/`.
- Builds a synthetic "added file" diff for each file (no real PR or commit required).
- Sends every file through the existing FastAPI review agent (default: 1 file per request with automatic fallback).
- Stores all findings in the Neon `findings` table under a new `review_id`.
- Prints a summary at the end.

Example output:

```text
Found 30 evaluation file(s) under evals/datasets
Agent URL: http://127.0.0.1:8000
Created evaluation review (ID: 100)
  [ok] javascript/js_01_clean.js
  [ok] javascript/js_04_bug.js
  ...
==================================================
Evaluation completed.
Files reviewed    : 30
Files failed      : 0
Review ID         : 100
Findings generated: 125
==================================================

To evaluate against ground truth:
  python evals/evaluate.py --review-id 100
```

Optional flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--dataset PATH` | `evals/datasets` | Path to evaluation dataset root |
| `--batch-size N` | `1` | Files per agent request |
| `--verbose` | off | Print per-batch detail |

---

### Step 2 — Copy the Review ID

Copy the `Review ID` from the output above (e.g. `97`).

---

### Step 3 — Compare against ground truth

```bash
python evals/evaluate.py --review-id 97
```

This fetches the findings for that review ID from Neon, normalizes paths and categories, and evaluates them against `evals/ground_truth.json`.

---

### Path normalization

Files stored in the database as `javascript/js_04_bug.js` (relative to `evals/datasets/`) are automatically normalized to match ground truth entries like `javascript/js_04_bug.js` by the evaluator. The `evals/` prefix, `datasets/` prefix, and full absolute paths are all stripped correctly.

---

## Evaluating a Review from Neon PostgreSQL (by ID)

## Running the Evaluator

### Evaluating directly by review_id from Neon PostgreSQL

The evaluator connects directly to Neon PostgreSQL using existing project credentials, fetches all findings associated with `--review-id`, normalizes them into the standard evaluation schema, saves them to `evals/predictions.json`, and evaluates them against `ground_truth.json`:

```bash
python evals/evaluate.py --review-id 94
```

To specify a custom output path for saving the predictions:

```bash
python evals/evaluate.py --review-id 94 --save-predictions evals/predictions.json
```

### Evaluating from a predictions JSON file

If you already have exported predictions, pass the path as a positional argument or with `--predictions`:

```bash
python evals/evaluate.py evals/predictions.json
```

Or:

```bash
python evals/evaluate.py --predictions evals/predictions.json
```

If no arguments are provided, `python evals/evaluate.py` will automatically load `evals/predictions.json` if present.

### Custom Ground Truth Path

You can pass a custom ground-truth file using `--ground-truth`:

```bash
python evals/evaluate.py --review-id 94 --ground-truth evals/ground_truth.json
```

## Neon Database Retrieval & Schema Normalization

When retrieving findings from Neon PostgreSQL:
- The evaluator checks for native PostgreSQL drivers or uses the project data access layer in `apps/api/src/db/index.js`.
- Findings in the `findings` table are mapped to the prediction schema:
  - `path` -> `file` (path prefixes like `evals/datasets/`, `evals/code_review_eval_dataset/datasets/`, and line number suffixes are normalized to standard dataset relative paths)
  - `line` -> `line`
  - `category` -> `category` (converted to UPPERCASE and normalized, e.g. `correctness`/`logic`/`runtime` mapped to `BUG`)
  - `severity` -> `severity` (converted to UPPERCASE)
  - `title` + `body` -> `description` (joined into descriptive text)

## Metrics and Semantic Matching

### Semantic Matching Criteria
A predicted finding matches a ground-truth finding if:
1. **File match**: Both reference the same normalized relative file path.
2. **Category match**: Both belong to the same normalized category (`BUG`, `SECURITY`, `PERFORMANCE`, `STYLE`).
3. **Line or Semantic overlap**:
   - The reported line is within 3 lines of the ground-truth line (`abs(gt_line - pred_line) <= 3`), OR
   - The semantic word overlap between predicted description and ground-truth description is at least 30% (`overlap >= 0.30`).

### Strict 1-to-1 Matching
Matching enforces strict 1-to-1 assignment. When multiple ground-truth items match a prediction, candidates are ranked by smallest line distance followed by highest semantic word overlap. Each ground-truth item can only be matched once.

### Reported Metrics
- **True Positives (TP)**: Predicted findings correctly matching ground-truth issues.
- **False Positives (FP)**: Predicted findings that do not correspond to any ground-truth issue.
- **False Negatives (FN)**: Ground-truth issues that were not caught by the reviewer.
- **Precision**: `TP / (TP + FP)` - Accuracy of flagged issues.
- **Recall**: `TP / (TP + FN)` - Percentage of real issues successfully detected.
- **F1 Score**: Harmonic mean of Precision and Recall (`2 * Precision * Recall / (Precision + Recall)`).
- **Severity Accuracy**: Percentage of true positive matches where the predicted severity matched the ground-truth severity.
- **Recall by Category**: Detection recall broken down per category (`BUG`, `PERFORMANCE`, `SECURITY`, `STYLE`).
- **False Positives List**: Detailed listing of unmatched predicted findings.
- **False Negatives List**: Detailed listing of missed ground-truth findings.

## Benchmark Performance Results

### Latest Benchmark Evaluation (Review ID: 100)

Evaluated against `ground_truth.json`:

```text
CODE REVIEW EVALUATION
============================
Ground truth findings : 74
Predicted findings    : 125
True positives        : 62
False positives       : 63
False negatives       : 12
Precision             : 49.60%
Recall                : 83.78%
F1                    : 62.31%
Severity accuracy     : 64.52%

Recall by category
BUG          14/15 (93.33%)
PERFORMANCE  14/18 (77.78%)
SECURITY     19/22 (86.36%)
STYLE        15/19 (78.95%)
```

### Performance Progression (Baseline Review 94 vs. Review 100)

| Metric | Baseline (Review 94) | Regression Run | Latest (Review 100) | Net vs. Baseline |
|--------|----------------------|----------------|---------------------|------------------|
| **Files Processed** | 30 / 30 | 10 / 30 (20 failed) | **30 / 30 (0 failed)** | **0 errors** |
| **Ground Truth Findings** | 74 | 74 | **74** | — |
| **Predicted Findings** | 29 | 8 | **125** | +96 |
| **True Positives (TP)** | 22 | 6 | **62** | **+40** |
| **False Positives (FP)** | 7 | 2 | **63** | +56 |
| **False Negatives (FN)** | 52 | 68 | **12** | **-40** |
| **Precision** | 75.86% | 75.00% | **79.60%** | +4.60% |
| **Recall** | 29.73% | 8.11% | **83.78%** | **+54.05%** |
| **F1 Score** | 42.72% | 14.63% | **62.31%** | **+19.59%** |
| **Severity Accuracy** | 81.82% | — | **64.52%** | -17.30% |

### Category-wise Recall Progression

- **BUG**: 4/15 (26.67%) → **14/15 (93.33%)** (+66.66%)
- **PERFORMANCE**: 3/18 (16.67%) → **14/18 (77.78%)** (+61.11%)
- **SECURITY**: 14/22 (63.64%) → **19/22 (86.36%)** (+22.72%)
- **STYLE**: 1/19 (5.26%) → **15/19 (78.95%)** (+73.69%)
