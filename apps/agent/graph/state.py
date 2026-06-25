from typing import Annotated, Any, TypedDict


def merge_findings(left: list, right: list) -> list:
    combined = (left or []) + (right or [])
    deduped = {}
    for item in combined:
        key = (item.get("category"), item.get("severity"), item.get("path"), item.get("line"), item.get("title"))
        if key not in deduped or item.get("confidence", 0) > deduped[key].get("confidence", 0):
            deduped[key] = item
    return list(deduped.values())


class Finding(TypedDict, total=False):
    category: str
    severity: str
    title: str
    body: str
    path: str | None
    line: int | None
    confidence: float
    metadata: dict[str, Any]


class GraphState(TypedDict, total=False):
    repository: dict[str, Any]
    pullRequest: dict[str, Any]
    files: list[dict[str, Any]]
    diff: str
    agent_plan: list[str]
    findings: Annotated[list[Finding], merge_findings]
    summary: str
    risk_score: float
    markdown: str
