import os
from pathlib import Path
from rag.embeddings import embed_text, tokenize

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".next", "dist", "build"}
TEXT_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".php", ".rs", ".sql", ".md", ".json", ".yml", ".yaml"}


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
                "id": f"{rel_path}:{index}".replace("/", "__"),
                "values": await embed_text(chunk),
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
