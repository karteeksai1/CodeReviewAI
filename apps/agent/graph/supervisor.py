import asyncio
from typing import Any

from graph.agents.performance import performance_agent
from graph.agents.security import security_agent
from graph.agents.style import style_agent
from graph.nodes.aggregator import aggregate_findings
from graph.nodes.github_poster import prepare_github_post
from graph.state import GraphState

try:
    from langgraph.graph import END, START, StateGraph
except Exception:
    END = START = StateGraph = None


def supervisor_node(state: GraphState) -> GraphState:
    plan = set()
    for file in state.get("files", []):
        path = file.get("path", "").lower()
        patch = file.get("patch", "").lower()
        if any(token in path for token in ["auth", "session", "token", "secret"]):
            plan.add("security")
        if any(token in patch for token in ["select", "query", "await", "for "]):
            plan.add("performance")
        plan.add("style")
    return {"agent_plan": sorted(plan or {"security", "performance", "style"})}


async def security_node(state: GraphState) -> GraphState:
    return {"findings": await security_agent(state)} if "security" in state.get("agent_plan", []) else {"findings": []}


async def performance_node(state: GraphState) -> GraphState:
    return {"findings": await performance_agent(state)} if "performance" in state.get("agent_plan", []) else {"findings": []}


async def style_node(state: GraphState) -> GraphState:
    return {"findings": await style_agent(state)} if "style" in state.get("agent_plan", []) else {"findings": []}


async def aggregator_node(state: GraphState) -> GraphState:
    return aggregate_findings(state)


async def github_poster_node(state: GraphState) -> GraphState:
    return await prepare_github_post(state)


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
        state.update(supervisor_node(state))
        security, performance, style = await asyncio.gather(security_agent(state), performance_agent(state), style_agent(state))
        state["findings"] = security + performance + style
        state.update(aggregate_findings(state))
        state.update(await prepare_github_post(state))
        final_state = state
    return {
        "summary": final_state.get("summary", "Review complete."),
        "risk_score": final_state.get("risk_score", 0),
        "findings": final_state.get("findings", []),
        "markdown": final_state.get("markdown", ""),
        "agent_plan": final_state.get("agent_plan", []),
    }
