import hashlib
import os
import re

import httpx


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in re.findall(r"[a-zA-Z0-9_]+", text)]


def embedding_dimensions() -> int:
    return int(os.getenv("EMBEDDING_DIMENSIONS", "384"))


async def embed_text(text: str) -> list[float]:
    api_key = os.getenv("HUGGINGFACE_API_KEY") or os.getenv("HF_TOKEN")
    model = os.getenv("HUGGINGFACE_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    if not api_key:
        return stable_hash_embedding(text)

    url = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{model}"
    async with httpx.AsyncClient(timeout=httpx.Timeout(float(os.getenv("HUGGINGFACE_TIMEOUT_SECONDS", "45")))) as client:
        response = await client.post(
            url,
            headers={"authorization": f"Bearer {api_key}"},
            json={"inputs": text, "options": {"wait_for_model": True}},
        )
        response.raise_for_status()

    return _pool_embedding(response.json())


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
