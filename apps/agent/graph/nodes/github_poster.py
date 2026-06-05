async def prepare_github_post(state):
    findings = state.get("findings", [])
    lines = ["## CodeReviewAI review", "", state.get("summary", "Review complete.")]
    if findings:
        lines += ["", "### Findings"]
        for item in findings[:10]:
            location = item.get("path") or ""
            if item.get("line"):
                location = f"{location}:{item['line']}"
            lines.append(f"- **{item.get('severity')} / {item.get('category')}** ({location}): {item.get('title')}")
    return {"markdown": "\n".join(lines), "posted": False}
