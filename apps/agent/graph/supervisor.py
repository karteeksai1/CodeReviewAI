import asyncio
import importlib
import time
from datetime import datetime, timezone
from time import perf_counter
from typing import Any
import logging

structlog = None
try:
    structlog = importlib.import_module("structlog")
except ImportError:
    pass

if structlog is not None:
    logger = structlog.get_logger()
else:
    logger = logging.getLogger(__name__)

from graph.agents.performance import performance_agent
from graph.agents.security import security_agent
from graph.agents.style import style_agent
from graph.nodes.aggregator import aggregate_findings
from graph.nodes.github_poster import prepare_github_post
from graph.state import GraphState
from llm.groq import groq_json, request_id_var, token_usage_var

try:
    langgraph_graph = importlib.import_module("langgraph.graph")
    END = langgraph_graph.END
    START = langgraph_graph.START
    StateGraph = langgraph_graph.StateGraph
except Exception:
    END = START = StateGraph = None


async def supervisor_node(state: GraphState) -> GraphState:
    req_id = request_id_var.get()
    start_time = time.perf_counter()
    tokens_before = token_usage_var.get()
    system = (
        "You are a routing supervisor for CodeReviewAI. Analyze the provided PR diff and file paths. "
        "Decide which review agents need to run. Options are: 'security', 'performance', 'style'. "
        "Return a JSON object with a single key 'agent_plan' containing a list of the chosen agents. "
        "Always include 'style'."
    )
    user = f"Diff:\n{state.get('diff', '')}"
    try:
        result = await groq_json(system, user)
        plan = result.get("agent_plan", ["security", "performance", "style"])
    except Exception:
        plan = ["security", "performance", "style"]
    duration = int((time.perf_counter() - start_time) * 1000)
    tokens_used = token_usage_var.get() - tokens_before
    logger.info(
        "Agent completed",
        agent="supervisor",
        request_id=req_id,
        latency_ms=duration,
        token_usage=tokens_used,
        plan=plan
    )
    return {"agent_plan": plan}


async def security_node(state: GraphState) -> GraphState:
    req_id = request_id_var.get()
    start_time = time.perf_counter()
    tokens_before = token_usage_var.get()
    findings = []
    if "security" in state.get("agent_plan", []):
        findings = await security_agent(state)
    duration = int((time.perf_counter() - start_time) * 1000)
    tokens_used = token_usage_var.get() - tokens_before
    logger.info(
        "Agent completed",
        agent="security",
        request_id=req_id,
        latency_ms=duration,
        token_usage=tokens_used,
        findings_count=len(findings)
    )
    return {"findings": findings}


async def performance_node(state: GraphState) -> GraphState:
    req_id = request_id_var.get()
    start_time = time.perf_counter()
    tokens_before = token_usage_var.get()
    findings = []
    if "performance" in state.get("agent_plan", []):
        findings = await performance_agent(state)
    duration = int((time.perf_counter() - start_time) * 1000)
    tokens_used = token_usage_var.get() - tokens_before
    logger.info(
        "Agent completed",
        agent="performance",
        request_id=req_id,
        latency_ms=duration,
        token_usage=tokens_used,
        findings_count=len(findings)
    )
    return {"findings": findings}


async def style_node(state: GraphState) -> GraphState:
    req_id = request_id_var.get()
    start_time = time.perf_counter()
    tokens_before = token_usage_var.get()
    findings = []
    if "style" in state.get("agent_plan", []):
        findings = await style_agent(state)
    duration = int((time.perf_counter() - start_time) * 1000)
    tokens_used = token_usage_var.get() - tokens_before
    logger.info(
        "Agent completed",
        agent="style",
        request_id=req_id,
        latency_ms=duration,
        token_usage=tokens_used,
        findings_count=len(findings)
    )
    return {"findings": findings}


async def aggregator_node(state: GraphState) -> GraphState:
    req_id = request_id_var.get()
    start_time = time.perf_counter()
    tokens_before = token_usage_var.get()
    result = aggregate_findings(state)
    duration = int((time.perf_counter() - start_time) * 1000)
    tokens_used = token_usage_var.get() - tokens_before
    logger.info(
        "Agent completed",
        agent="aggregator",
        request_id=req_id,
        latency_ms=duration,
        token_usage=tokens_used
    )
    return result


async def github_poster_node(state: GraphState) -> GraphState:
    req_id = request_id_var.get()
    start_time = time.perf_counter()
    tokens_before = token_usage_var.get()
    result = await prepare_github_post(state)
    duration = int((time.perf_counter() - start_time) * 1000)
    tokens_used = token_usage_var.get() - tokens_before
    logger.info(
        "Agent completed",
        agent="github_poster",
        request_id=req_id,
        latency_ms=duration,
        token_usage=tokens_used
    )
    return result


def build_graph():
    if StateGraph is None:
        return None
    workflow = StateGraph(GraphState)
    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("security", security_node)
    workflow.add_node("performance", performance_node)
    workflow.add_node("style", style_node)
    workflow.add_node("aggregator", aggregator_node)
    workflow.add_node("github_poster", github_poster_node)
    workflow.add_edge(START, "supervisor")
    workflow.add_edge("supervisor", "security")
    workflow.add_edge("supervisor", "performance")
    workflow.add_edge("supervisor", "style")
    workflow.add_edge(["security", "performance", "style"], "aggregator")
    workflow.add_edge("aggregator", "github_poster")
    workflow.add_edge("github_poster", END)
    return workflow.compile()


GRAPH = build_graph()


async def run_review(payload: dict[str, Any]) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    timer = perf_counter()
    state: GraphState = {
        "repository": payload["repository"],
        "pullRequest": payload["pullRequest"],
        "files": payload.get("files", []),
        "diff": payload.get("diff", ""),
        "findings": [],
    }
    if GRAPH is not None:
        final_state = await GRAPH.ainvoke(state)
    else:
        state.update(await supervisor_node(state))
        security, performance, style = await asyncio.gather(security_agent(state), performance_agent(state), style_agent(state))
        state["findings"] = security + performance + style
        state.update(aggregate_findings(state))
        state.update(await prepare_github_post(state))
        final_state = state
    completed = datetime.now(timezone.utc)
    duration_ms = int((perf_counter() - timer) * 1000)
    planned = set(final_state.get("agent_plan", ["security", "performance", "style"]))
    findings = final_state.get("findings", [])
    dep_latency = final_state.get("dependency_latency_ms", 0)
    logger.info(
        "Review run complete",
        total_duration_ms=duration_ms,
        dependency_latency_ms=dep_latency,
        planned=list(planned)
    )
    agent_runs = [
        {
            "agent": agent,
            "status": "completed" if agent in planned else "skipped",
            "started_at": started.isoformat(),
            "completed_at": completed.isoformat(),
            "duration_ms": duration_ms,
            "finding_count": len([item for item in findings if item.get("category") == agent]),
        }
        for agent in ["security", "performance", "style"]
    ]
    return {
        "summary": final_state.get("summary", "Review complete."),
        "risk_score": final_state.get("risk_score", 0),
        "findings": findings,
        "markdown": final_state.get("markdown", ""),
        "agent_plan": final_state.get("agent_plan", []),
        "agent_runs": agent_runs,
        "dependency_latency_ms": dep_latency,
    }
