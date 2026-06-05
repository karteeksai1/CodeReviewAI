import os

from rag.indexer import get_pinecone, stable_hash_embedding, tokenize


async def retrieve_context(namespace, query, limit=3):
    client = get_pinecone()
    if not client:
        return []
    try:
        result = client.Index(os.getenv("PINECONE_INDEX")).query(
            namespace=namespace,
            vector=stable_hash_embedding(query),
            top_k=limit,
            include_metadata=True,
            filter={"bm25_terms": {"$in": tokenize(query)[:20]}},
        )
        return [{"path": match.metadata.get("path"), "text": match.metadata.get("text", "")[:600], "score": match.score} for match in result.matches]
    except Exception:
        return []
