from graph.agents.common import SEVERITY_WEIGHT


def aggregate_findings(state):
    deduped = {}
    for item in state.get("findings", []):
        key = (item.get("category"), item.get("severity"), item.get("path"), item.get("line"), item.get("title"))
        if key not in deduped or item.get("confidence", 0) > deduped[key].get("confidence", 0):
            deduped[key] = item
    ranked = sorted(deduped.values(), key=lambda item: (SEVERITY_WEIGHT.get(item.get("severity", "info"), 0), item.get("confidence", 0)), reverse=True)
    risk_score = min(100, sum(SEVERITY_WEIGHT.get(item.get("severity", "info"), 0) for item in ranked) / 3)
    summary = "No actionable security, performance, or style findings were detected."
    if ranked:
        top = ranked[0]
        summary = f"Detected {len(ranked)} finding(s). Highest priority: {top.get('severity')} {top.get('category')} issue, {top.get('title')}."
    return {"findings": ranked, "risk_score": round(risk_score, 2), "summary": summary}
