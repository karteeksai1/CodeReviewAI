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
    local_path = repo_path
    if "/" in repo_path and not os.path.isabs(repo_path) and not repo_path.startswith("."):
        local_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "repos", repo_path)
        if not os.path.exists(local_path):
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            import subprocess
            subprocess.run(["git", "clone", f"https://github.com/{repo_path}.git", local_path], check=True)
        else:
            import subprocess
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
