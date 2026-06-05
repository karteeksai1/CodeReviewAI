import json
import os
from typing import Any

import httpx


GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"


def groq_enabled() -> bool:
    return bool(os.getenv("GROQ_API_KEY"))


async def groq_json(system: str, user: str, *, temperature: float = 0.1) -> dict[str, Any]:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return {}

    payload = {
        "model": os.getenv("GROQ_MODEL", "llama-3.1-70b-versatile"),
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    timeout = httpx.Timeout(float(os.getenv("GROQ_TIMEOUT_SECONDS", "30")))
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            GROQ_CHAT_URL,
            headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {}


def diff_excerpt(files: list[dict[str, Any]], *, max_chars: int = 9000) -> str:
    parts = []
    total = 0
    for file in files:
        header = f"\n--- {file.get('path', 'unknown')} ({file.get('status', 'modified')}) ---\n"
        patch = file.get("patch", "")
        chunk = header + patch
        if total + len(chunk) > max_chars:
            remaining = max_chars - total
            if remaining > len(header):
                parts.append(chunk[:remaining])
            break
        parts.append(chunk)
        total += len(chunk)
    return "".join(parts)


def normalize_findings(raw: Any, category: str) -> list[dict[str, Any]]:
    if isinstance(raw, dict):
        raw = raw.get("findings", [])
    if not isinstance(raw, list):
        return []

    findings = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        severity = str(item.get("severity", "info")).lower()
        if severity not in {"critical", "high", "medium", "low", "info"}:
            severity = "info"
        findings.append({
            "category": str(item.get("category") or category),
            "severity": severity,
            "title": str(item.get("title") or "LLM finding"),
            "body": str(item.get("body") or item.get("recommendation") or ""),
            "path": item.get("path"),
            "line": _line_or_none(item.get("line")),
            "confidence": float(item.get("confidence", 0.72)),
            "metadata": {"provider": "groq", **(item.get("metadata") if isinstance(item.get("metadata"), dict) else {})},
        })
    return findings


def _line_or_none(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None
