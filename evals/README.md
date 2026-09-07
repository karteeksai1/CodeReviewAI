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
