import os
import time
from pathlib import Path
import httpx
import structlog
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=env_path)

from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

from graph.supervisor import run_review
from rag.indexer import index_repository, get_pinecone
from llm.groq import request_id_var, token_usage_var

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger()

app = FastAPI(title="CodeReviewAI Agent")


class FilePatch(BaseModel):
    path: str
    status: str | None = None
    additions: int = 0
    deletions: int = 0
    changes: int = 0
    patch: str = ""


class PullRequest(BaseModel):
    id: int | None = None
    number: int
    title: str = ""
    body: str | None = None
    author: str | None = None
    baseSha: str | None = None
    headSha: str | None = None
    isDraft: bool = False
    url: str | None = None


class Repository(BaseModel):
    owner: str
    name: str
    fullName: str


class ReviewRequest(BaseModel):
    repository: Repository
    pullRequest: PullRequest
    files: list[FilePatch] = Field(default_factory=list)
    diff: str = ""


class IndexRequest(BaseModel):
    repo_path: str
    namespace: str


@app.get("/health")
async def health():
    pinecone_ok = False
    try:
        pc_index = os.getenv("PINECONE_INDEX")
        client = get_pinecone()
        if client and pc_index:
            client.Index(pc_index).describe_index_stats()
            pinecone_ok = True
    except Exception:
        pass

    groq_ok = False
    try:
        api_key = os.getenv("GROQ_API_KEY")
        if api_key:
            async with httpx.AsyncClient() as client:
                res = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"authorization": f"Bearer {api_key}"},
                    timeout=5.0
                )
                if res.status_code == 200:
                    groq_ok = True
    except Exception:
        pass

    return {
        "ok": True,
        "service": "agent",
        "pinecone": pinecone_ok,
        "groq": groq_ok
    }


@app.post("/warmup")
async def warmup():
    import asyncio
    from llm.groq import groq_json
    async def _do_warmup():
        try:
            await groq_json("Ping", "Ping")
        except Exception:
            pass
    asyncio.create_task(_do_warmup())
    return {"ok": True}


@app.post("/review")
async def review(request: ReviewRequest, req: Request):
    req_id = req.headers.get("x-request-id", "unknown-request-id")
    request_id_var.set(req_id)
    token_usage_var.set(0)
    start_time = time.perf_counter()
    try:
        result = await run_review(request.model_dump())
        latency = int((time.perf_counter() - start_time) * 1000)
        logger.info(
            "Agent review finished",
            request_id=req_id,
            latency_ms=latency,
            token_usage=token_usage_var.get(),
            agent_plan=result.get("agent_plan", [])
        )
        return result
    except Exception as e:
        latency = int((time.perf_counter() - start_time) * 1000)
        logger.error(
            "Agent review failed",
            request_id=req_id,
            latency_ms=latency,
            token_usage=token_usage_var.get(),
            error=str(e)
        )
        raise e


@app.post("/index")
async def index(request: IndexRequest, req: Request):
    req_id = req.headers.get("x-request-id", "unknown-request-id")
    request_id_var.set(req_id)
    start_time = time.perf_counter()
    try:
        result = await index_repository(request.repo_path, request.namespace)
        latency = int((time.perf_counter() - start_time) * 1000)
        logger.info(
            "Indexing finished",
            request_id=req_id,
            latency_ms=latency,
            namespace=request.namespace
        )
        return result
    except Exception as e:
        latency = int((time.perf_counter() - start_time) * 1000)
        logger.error(
            "Indexing failed",
            request_id=req_id,
            latency_ms=latency,
            error=str(e)
        )
        raise e
