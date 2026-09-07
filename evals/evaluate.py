import json
import sys
from collections import Counter

def norm(value):
    return " ".join(str(value).lower().split())

def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)["findings"]

def match(gt, pred):
    if norm(gt["file"]) != norm(pred.get("file", "")):
        return False
    if norm(gt["category"]) != norm(pred.get("category", "")):
        return False

    gt_line = int(gt.get("line", 0))
    pred_line = int(pred.get("line", 0))
    line_close = abs(gt_line - pred_line) <= 3

    gt_words = {w for w in norm(gt["description"]).split() if len(w) >= 4}
    pred_words = {w for w in norm(pred.get("description", "")).split() if len(w) >= 4}
    overlap = len(gt_words & pred_words) / max(1, len(gt_words))

    return line_close or overlap >= 0.35

def main():
    if len(sys.argv) != 2:
        print("Usage: python evaluate.py predictions.json")
        raise SystemExit(1)

    gt = load("ground_truth.json")
    pred = load(sys.argv[1])

    remaining = list(gt)
    matched = []
    false_positive = []

    for p in pred:
        hit = next((g for g in remaining if match(g, p)), None)
        if hit is None:
            false_positive.append(p)
        else:
            matched.append((hit, p))
            remaining.remove(hit)

    false_negative = remaining
    tp = len(matched)
    fp = len(false_positive)
    fn = len(false_negative)

    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if precision + recall else 0.0
    severity_ok = sum(norm(g["severity"]) == norm(p.get("severity", "")) for g, p in matched)
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

    counts = Counter(g["category"] for g in gt)
    hits = Counter(g["category"] for g, _ in matched)
    print("\nRecall by category")
    for category in sorted(counts):
        print(f"{category:12} {hits[category]}/{counts[category]} ({hits[category]/counts[category]:.2%})")

    if false_positive:
        print("\nFalse positives")
        for p in false_positive:
            print(f"- {p.get('file')}:{p.get('line')} {p.get('category')} {p.get('description')}")

    if false_negative:
        print("\nFalse negatives")
        for g in false_negative:
            print(f"- {g['file']}:{g['line']} {g['category']} {g['description']}")

if __name__ == "__main__":
    main()
