from fastapi import FastAPI
from pydantic import BaseModel, Field

from graph.supervisor import run_review
from rag.indexer import index_repository

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
def health():
    return {"ok": True, "service": "agent"}


@app.post("/review")
async def review(request: ReviewRequest):
    return await run_review(request.model_dump())


@app.post("/index")
async def index(request: IndexRequest):
    return await index_repository(request.repo_path, request.namespace)
