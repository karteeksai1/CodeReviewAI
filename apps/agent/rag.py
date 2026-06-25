import hashlib
import os
import re
import httpx
import subprocess
from pathlib import Path
import dotenv

try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(dotenv_path=env_path)
except Exception:
    pass

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".next", "dist", "build"}
TEXT_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".php", ".rs", ".sql", ".md", ".json", ".yml", ".yaml"}


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in re.findall(r"[a-zA-Z0-9_]+", text)]


def embedding_dimensions() -> int:
    return int(os.getenv("EMBEDDING_DIMENSIONS", "384"))


async def embed_text(text: str) -> list[float]:
    api_key = os.getenv("HUGGINGFACE_API_KEY") or os.getenv("HF_TOKEN")
    model = os.getenv("HUGGINGFACE_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    if not api_key or api_key == "replace-me":
        return stable_hash_embedding(text)

    url = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{model}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(float(os.getenv("HUGGINGFACE_TIMEOUT_SECONDS", "45")))) as client:
            response = await client.post(
                url,
                headers={"authorization": f"Bearer {api_key}"},
                json={"inputs": text, "options": {"wait_for_model": True}},
            )
            response.raise_for_status()
        return _pool_embedding(response.json())
    except Exception:
        return stable_hash_embedding(text)


def stable_hash_embedding(text: str, dims: int | None = None) -> list[float]:
    dims = dims or embedding_dimensions()
    values = [0.0] * dims
    for token in tokenize(text):
        digest = hashlib.sha256(token.encode("utf8")).digest()
        values[int.from_bytes(digest[:2], "big") % dims] += 1.0
    norm = sum(value * value for value in values) ** 0.5 or 1.0
    return [value / norm for value in values]


def _pool_embedding(payload) -> list[float]:
    if isinstance(payload, list) and payload and all(isinstance(value, (int, float)) for value in payload):
        vector = [float(value) for value in payload]
    elif isinstance(payload, list) and payload and isinstance(payload[0], list):
        rows = payload[0] if payload and payload and isinstance(payload[0][0], list) else payload
        dims = len(rows[0]) if rows else embedding_dimensions()
        vector = [sum(float(row[i]) for row in rows) / len(rows) for i in range(dims)]
    else:
        vector = stable_hash_embedding(str(payload))

    norm = sum(value * value for value in vector) ** 0.5 or 1.0
    return [value / norm for value in vector]


def chunk_text(text, max_chars=1800, overlap=250):
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        yield text[start:end]
        if end == len(text):
            break
        start = max(0, end - overlap)


def iter_source_files(repo_path):
    root = Path(repo_path)
    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix.lower() in TEXT_EXTENSIONS:
            yield path


async def index_repository(repo_path, namespace):
    local_path = repo_path
    if "/" in repo_path and not os.path.isabs(repo_path) and not repo_path.startswith("."):
        local_path = os.path.join(os.path.dirname(__file__), "repos", repo_path)
        if not os.path.exists(local_path):
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            subprocess.run(["git", "clone", f"https://github.com/{repo_path}.git", local_path], check=True)
        else:
            try:
                subprocess.run(["git", "-C", local_path, "pull"], check=False)
            except Exception:
                pass
    vectors = []
    for source_file in iter_source_files(local_path):
        rel_path = str(Path(source_file).relative_to(local_path))
        text = source_file.read_text(encoding="utf8", errors="ignore")
        for index, chunk in enumerate(chunk_text(text)):
            vectors.append({
                "id": f"{rel_path}:{index}".replace("/", "__"),
                "values": await embed_text(chunk),
                "metadata": {"path": rel_path, "chunk_index": index, "bm25_terms": tokenize(chunk)[:300], "text": chunk[:3500]},
            })
    client = get_pinecone()
    if client and vectors:
        idx = client.Index(os.getenv("PINECONE_INDEX"))
        for i in range(0, len(vectors), 100):
            batch = vectors[i:i+100]
            try:
                idx.upsert(vectors=batch, namespace=namespace)
            except Exception:
                pass
    return {"namespace": namespace, "chunks": len(vectors), "pinecone": bool(client)}


def get_pinecone():
    if not os.getenv("PINECONE_API_KEY") or not os.getenv("PINECONE_INDEX"):
        return None
    try:
        from pinecone import Pinecone
        return Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    except Exception:
        return None


async def retrieve_context(namespace, query, limit=3):
    client = get_pinecone()
    if not client:
        return []
    try:
        result = client.Index(os.getenv("PINECONE_INDEX")).query(
            namespace=namespace,
            vector=await embed_text(query),
            top_k=limit,
            include_metadata=True,
            filter={"bm25_terms": {"$in": tokenize(query)[:20]}},
        )
        return [{"path": match.metadata.get("path"), "text": match.metadata.get("text", "")[:600], "score": match.score} for match in result.matches]
    except Exception:
        return []
