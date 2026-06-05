import hashlib
import os
import re
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".next", "dist", "build"}
TEXT_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".php", ".rs", ".sql", ".md", ".json", ".yml", ".yaml"}


def tokenize(text):
    return [token.lower() for token in re.findall(r"[a-zA-Z0-9_]+", text)]


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
    vectors = []
    for source_file in iter_source_files(repo_path):
        rel_path = str(Path(source_file).relative_to(repo_path))
        text = source_file.read_text(encoding="utf8", errors="ignore")
        for index, chunk in enumerate(chunk_text(text)):
            vectors.append({
                "id": hashlib.sha1(f"{rel_path}:{index}".encode("utf8")).hexdigest(),
                "values": stable_hash_embedding(chunk),
                "metadata": {"path": rel_path, "chunk_index": index, "bm25_terms": tokenize(chunk)[:300], "text": chunk[:3500]},
            })
    client = get_pinecone()
    if client and vectors:
        client.Index(os.getenv("PINECONE_INDEX")).upsert(vectors=vectors, namespace=namespace)
    return {"namespace": namespace, "chunks": len(vectors), "pinecone": bool(client)}


def get_pinecone():
    if not os.getenv("PINECONE_API_KEY") or not os.getenv("PINECONE_INDEX"):
        return None
    try:
        from pinecone import Pinecone
        return Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    except Exception:
        return None


def stable_hash_embedding(text, dims=384):
    values = [0.0] * dims
    for token in tokenize(text):
        digest = hashlib.sha256(token.encode("utf8")).digest()
        values[int.from_bytes(digest[:2], "big") % dims] += 1.0
    norm = sum(value * value for value in values) ** 0.5 or 1.0
    return [value / norm for value in values]
