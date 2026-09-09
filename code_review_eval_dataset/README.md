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
├── evaluate.py
└── README.md
```

## Metrics

The evaluation script reports:

- Precision
- Recall
- F1 score
- Severity accuracy
- Recall by category
- False positives
- False negatives

The matching logic uses file + category and allows a nearby line or semantic description overlap. This is intentionally more tolerant than exact text matching because LLM reviewers can describe the same issue differently.

## Expected dataset behavior

Clean files have zero expected findings. Faulty files have one or more known findings. Mixed/all-category files intentionally combine bug, security, performance, and style issues.

## Running the evaluator

Have your code-review app export normalized findings:

```json
{
  "findings": [
    {
      "file": "python/py_04_bug.py",
      "line": 8,
      "category": "BUG",
      "severity": "HIGH",
      "description": "..."
    }
  ]
}
```

Then run:

```bash
python evaluate.py predictions.json
```

For a production-quality benchmark, keep this dataset fixed and do not change the ground truth after seeing model outputs except to correct genuine annotation mistakes.
