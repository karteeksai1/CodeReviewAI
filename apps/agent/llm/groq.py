import contextvars
import json
import os
from typing import Any

import httpx

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

request_id_var = contextvars.ContextVar("request_id", default="")
token_usage_var = contextvars.ContextVar("token_usage", default=0)


in_flight_groq_calls = 0
in_flight_lock = None


async def report_status(service: str, status: str):
    try:
        import os
        api_url = os.getenv("PUBLIC_API_URL", "http://localhost:3001")
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{api_url}/health/status",
                json={"service": service, "status": status},
                timeout=1.0
            )
    except Exception:
        pass


async def increment_groq_calls():
    global in_flight_groq_calls, in_flight_lock
    import asyncio
    if in_flight_lock is None:
        in_flight_lock = asyncio.Lock()
    async with in_flight_lock:
        in_flight_groq_calls += 1
        if in_flight_groq_calls == 1:
            await report_status("llm", "checking")


async def decrement_groq_calls(success=True):
    global in_flight_groq_calls, in_flight_lock
    import asyncio
    if in_flight_lock is None:
        in_flight_lock = asyncio.Lock()
    async with in_flight_lock:
        if in_flight_groq_calls > 0:
            in_flight_groq_calls -= 1
            if in_flight_groq_calls == 0:
                await report_status("llm", "ok" if success else "down")


def groq_enabled() -> bool:
    return bool(os.getenv("GROQ_API_KEY"))


async def groq_json(system: str, user: str, *, temperature: float = 0.1) -> dict[str, Any]:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return {}

    is_real_run = bool(request_id_var.get())
    if is_real_run:
        await increment_groq_calls()

    success = False
    try:
        payload = {
            "model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
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
        res_data = response.json()
        usage = res_data.get("usage", {})
        tokens = usage.get("total_tokens", 0)
        token_usage_var.set(token_usage_var.get() + tokens)
        content = res_data["choices"][0]["message"]["content"]
        try:
            success = True
            return json.loads(content)
        except json.JSONDecodeError:
            return {}
    except Exception as e:
        if is_real_run:
            await report_status("llm", "down")
        raise e
    finally:
        if is_real_run:
            await decrement_groq_calls(success)


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
