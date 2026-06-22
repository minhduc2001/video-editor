import json
import time
from typing import Any, Dict
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

SENSITIVE_QUERY_KEYS = {"key", "api_key", "apikey", "token", "access_token", "authorization"}
MAX_LOG_BODY_CHARS = 1200


def now() -> float:
    return time.perf_counter()


def elapsed_ms(start_time: float) -> int:
    return int((time.perf_counter() - start_time) * 1000)


def sanitize_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        query = urlencode(
            [
                (key, "***" if key.lower() in SENSITIVE_QUERY_KEYS else value)
                for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            ],
            doseq=True,
        )
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))
    except Exception:
        return url


def preview(value: Any, limit: int = MAX_LOG_BODY_CHARS) -> str:
    if value is None:
        return ""

    if not isinstance(value, str):
        try:
            value = json.dumps(value, ensure_ascii=False)
        except Exception:
            value = str(value)

    normalized = " ".join(value.strip().split())
    if len(normalized) <= limit:
        return normalized

    return f"{normalized[:limit]}...<truncated>"


def redact_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "***" if str(key).lower() in SENSITIVE_QUERY_KEYS else redact_sensitive(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]

    return value


def response_body(response: requests.Response) -> str:
    try:
        return preview(redact_sensitive(response.json()))
    except Exception:
        return preview(response.text)


def log_ai_start(
    provider: str,
    action: str,
    method: str,
    url: str,
    *,
    model: str = "",
    extra: Dict[str, Any] | None = None,
) -> float:
    details = {
        "provider": provider,
        "action": action,
        "method": method,
        "url": sanitize_url(url),
    }
    if model:
        details["model"] = model
    if extra:
        details.update(extra)

    print(f"[AI API] start {preview(details)}")
    return now()


def log_ai_success(
    provider: str,
    action: str,
    start_time: float,
    *,
    status_code: int | None = None,
    model: str = "",
    extra: Dict[str, Any] | None = None,
) -> None:
    details: Dict[str, Any] = {
        "provider": provider,
        "action": action,
        "elapsed_ms": elapsed_ms(start_time),
    }
    if status_code is not None:
        details["status_code"] = status_code
    if model:
        details["model"] = model
    if extra:
        details.update(extra)

    print(f"[AI API] success {preview(details)}")


def log_ai_failure(
    provider: str,
    action: str,
    start_time: float,
    error: BaseException,
    *,
    url: str = "",
    model: str = "",
    response: requests.Response | None = None,
    extra: Dict[str, Any] | None = None,
) -> None:
    if response is None and isinstance(error, requests.HTTPError):
        response = error.response

    details: Dict[str, Any] = {
        "provider": provider,
        "action": action,
        "elapsed_ms": elapsed_ms(start_time),
        "error_type": type(error).__name__,
        "error": str(error),
    }
    if url:
        details["url"] = sanitize_url(url)
    if model:
        details["model"] = model
    if response is not None:
        details["status_code"] = response.status_code
        details["response_body"] = response_body(response)
    if extra:
        details.update(extra)

    print(f"[AI API] failure {preview(details)}")
