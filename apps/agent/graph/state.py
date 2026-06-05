import operator
from typing import Annotated, Any, TypedDict


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
    findings: Annotated[list[Finding], operator.add]
    summary: str
    risk_score: float
    markdown: str
