import contextvars
import json
import os
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

request_id_var = contextvars.ContextVar("request_id", default="")
token_usage_var = contextvars.ContextVar("token_usage", default=0)
raw_response_var = contextvars.ContextVar("raw_response", default=[])
raw_response_log = []


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


async def groq_json(system: str, user: str, *, temperature: float = 0.1, is_warmup: bool = False) -> dict[str, Any]:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return {}

    is_real_run = not is_warmup
    if is_real_run:
        await increment_groq_calls()

    success = False
    try:
        import asyncio
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
        for attempt in range(5):
            try:
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
                if os.getenv("CAPTURE_RAW_GROQ") == "true":
                    raw_response_log.append(content)
                    raw_response_var.set([*raw_response_var.get(), content])
                try:
                    success = True
                    return json.loads(content)
                except json.JSONDecodeError:
                    return {}
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429 and attempt < 4:
                    await asyncio.sleep((attempt + 1) * 3)
                    continue
                raise e
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                if attempt < 4:
                    await asyncio.sleep((attempt + 1) * 3)
                    continue
                raise e
    except Exception as e:
        if is_real_run:
            await report_status("llm", "down")
        raise e
    finally:
        if is_real_run:
            await decrement_groq_calls(success)


def extract_file_patch_from_diff(full_diff: str, filename: str) -> str:
    if not full_diff or not filename:
        return ""
    chunks = full_diff.split("\ndiff --git ")
    for idx, chunk in enumerate(chunks):
        if idx > 0:
            chunk = "diff --git " + chunk
        lines = chunk.splitlines()
        if not lines:
            continue
        first_line = lines[0]
        if f"b/{filename}" in first_line or f"a/{filename}" in first_line:
            hunk_idx = chunk.find("\n@@")
            if hunk_idx != -1:
                return chunk[hunk_idx + 1:]
    return ""


def diff_excerpt(files: list[dict[str, Any]], full_diff: str = "", *, max_chars: int = 64000) -> str:
    parts = []
    total = 0
    for file in files:
        if file.get("status") == "removed":
            continue
        header = f"\n--- {file.get('path', 'unknown')} ({file.get('status', 'modified')}) ---\n"
        patch = (file.get("patch") or "").strip()
        source = "file_patch"
        if not patch and full_diff:
            extracted = extract_file_patch_from_diff(full_diff, file.get("path", ""))
            if extracted:
                patch = extracted.strip()
                source = "full_diff"
        if not patch and file.get("status") == "added" and file.get("content"):
            content_lines = file.get("content", "").splitlines()
            patch = f"@@ -0,0 +1,{len(content_lines)} @@\n" + "\n".join(f"+{line}" for line in content_lines)
            source = "synthesized_from_content"
        chunk = header + patch
        logger.info(
            "Prepared file diff excerpt",
            path=file.get("path"),
            status=file.get("status"),
            patch_source=source,
            patch_length=len(patch),
            patch_lines=len(patch.splitlines()) if patch else 0,
        )
        if total + len(chunk) > max_chars:
            remaining = max_chars - total
            if remaining > len(header):
                parts.append(chunk[:remaining])
            break
        parts.append(chunk)
        total += len(chunk)
    result = "".join(parts)
    actual_code_chars = sum(len((file.get("patch") or "").strip()) for file in files)
    if not actual_code_chars and len(result.strip()) < 30:
        logger.warning(
            "Empty or near-empty diff excerpt generated",
            file_count=len(files),
            total_chars=len(result),
        )
    return result


def normalize_findings(raw: Any, category: str) -> list[dict[str, Any]]:
    if isinstance(raw, dict):
        if isinstance(raw.get("findings"), list):
            raw = raw.get("findings", [])
        elif isinstance(raw.get("issues"), list):
            raw = raw.get("issues", [])
        elif isinstance(raw.get("results"), list):
            raw = raw.get("results", [])
        elif isinstance(raw.get("finding"), dict):
            raw = [raw.get("finding")]
        elif all(key in raw for key in ("title", "body")):
            raw = [raw]
        else:
            raw = []
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
            "confidence": _confidence_to_float(item.get("confidence")),
            "metadata": {"provider": "groq", **(item.get("metadata") if isinstance(item.get("metadata"), dict) else {})},
        })
    return findings


def _confidence_to_float(value: Any) -> float:
    try:
        if value is None or value == "":
            return 0.72
        if isinstance(value, (int, float)):
            return float(value)
        val_str = str(value).strip().lower()
        if val_str in {"critical", "high"}:
            return 0.9
        if val_str == "medium":
            return 0.75
        if val_str == "low":
            return 0.5
        if val_str == "info":
            return 0.3
        return float(val_str)
    except (TypeError, ValueError):
        return 0.72


def _line_or_none(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None
