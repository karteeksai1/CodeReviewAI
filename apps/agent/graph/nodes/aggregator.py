import re
from graph.agents.common import SEVERITY_WEIGHT


def aggregate_findings(state):
    deduped = {}
    for item in state.get("findings", []):
        key = (item.get("category"), item.get("severity"), item.get("path"), item.get("line"), item.get("title"))
        if key not in deduped or item.get("confidence", 0) > deduped[key].get("confidence", 0):
            deduped[key] = item
    ranked_candidates = sorted(deduped.values(), key=lambda item: (SEVERITY_WEIGHT.get(item.get("severity", "info"), 0), item.get("confidence", 0)), reverse=True)
    ranked = []
    for item in ranked_candidates:
        is_dup = False
        for existing in ranked:
            if existing.get("path") == item.get("path") and existing.get("line") == item.get("line") and existing.get("line") and existing.get("line") > 0:
                w1 = set(re.findall(r"\w+", existing.get("title", "").lower()))
                w2 = set(re.findall(r"\w+", item.get("title", "").lower()))
                stop_words = {"a", "an", "the", "in", "on", "at", "to", "for", "with", "is", "are", "was", "were", "of", "and", "or", "not", "has", "have", "method", "function", "class", "code"}
                common = (w1 & w2) - stop_words
                if len(common) >= 2:
                    is_dup = True
                    break
        if not is_dup:
            ranked.append(item)
    risk_score = min(100, sum(SEVERITY_WEIGHT.get(item.get("severity", "info"), 0) for item in ranked) / 3)
    summary = "No actionable security, performance, or style findings were detected."
    if ranked:
        top = ranked[0]
        summary = f"Detected {len(ranked)} finding(s). Highest priority: {top.get('severity')} {top.get('category')} issue, {top.get('title')}."
    return {"findings": ranked, "risk_score": round(risk_score, 2), "summary": summary}
