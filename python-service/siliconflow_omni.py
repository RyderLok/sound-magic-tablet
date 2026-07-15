"""Optional SiliconFlow Qwen3-Omni open-ended audio semantic analysis.

Uses SILICONFLOW_API_KEY / SILICONFLOW_OMNI_MODEL / SILICONFLOW_BASE_URL.
Does not modify naturalArchetype, strokePattern, or brushParams.
On any failure returns None (callers set semantic=null).
Never logs the API key.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

logger = logging.getLogger("siliconflow_omni")

DEFAULT_MODEL = "Qwen/Qwen3-Omni-30B-A3B-Instruct"
DEFAULT_BASE = "https://api.siliconflow.cn/v1"
REQUEST_TIMEOUT_SEC = 60.0

PROMPT = (
    "请开放识别这段录音里听到的内容，不要限制在预设类别。\n"
    "只返回 JSON，不要 markdown，不要其它文字。字段：\n"
    "{\n"
    '  "soundLabel": "简短声音标签（中文或英文）",\n'
    '  "description": "对听到内容的客观描述",\n'
    '  "possibleSources": ["可能的声源1", "可能的声源2"],\n'
    '  "audibleEvents": ["可听事件1", "可听事件2"],\n'
    '  "confidence": 0.0\n'
    "}\n"
    "confidence 为 0~1；不确定时仍给出最可能判断并降低 confidence。"
)


def is_configured() -> bool:
    key = (os.environ.get("SILICONFLOW_API_KEY") or "").strip()
    if not key:
        return False
    flag = (os.environ.get("SILICONFLOW_OMNI_ENABLED") or "1").strip().lower()
    return flag not in ("0", "false", "off", "no")


def status() -> Dict[str, Any]:
    return {
        "configured": is_configured(),
        "model": os.environ.get("SILICONFLOW_OMNI_MODEL", DEFAULT_MODEL),
        "baseUrl": os.environ.get("SILICONFLOW_BASE_URL", DEFAULT_BASE),
    }


def analyze_semantic(wav_bytes: bytes) -> Optional[Dict[str, Any]]:
    """Analyze WAV with Qwen3-Omni; return semantic dict or None."""
    if not is_configured() or not wav_bytes:
        return None

    api_key = (os.environ.get("SILICONFLOW_API_KEY") or "").strip()
    model = os.environ.get("SILICONFLOW_OMNI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    base = (os.environ.get("SILICONFLOW_BASE_URL") or DEFAULT_BASE).rstrip("/")

    try:
        data_url = (
            "data:audio/wav;base64,"
            + base64.b64encode(wav_bytes).decode("ascii")
        )
        body = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "你是音频内容识别助手。根据录音客观描述听到的声音，只输出 JSON。",
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "audio_url", "audio_url": {"url": data_url}},
                        {"type": "text", "text": PROMPT},
                    ],
                },
            ],
            "temperature": 0.2,
            "max_tokens": 512,
        }
        req = urllib.request.Request(
            f"{base}/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        text = (
            ((raw.get("choices") or [{}])[0].get("message") or {}).get("content")
            or ""
        )
        parsed = _parse_json_content(text)
        normalized = _normalize_semantic(parsed)
        if not normalized:
            logger.warning("Omni semantic response invalid or incomplete")
            return None
        normalized["model"] = model
        normalized["provider"] = "siliconflow"
        return normalized
    except urllib.error.HTTPError as exc:
        # Do not log response body (may echo request metadata); code only.
        logger.warning("Omni semantic HTTP error status=%s", exc.code)
        return None
    except Exception as exc:
        logger.warning("Omni semantic failed: %s", type(exc).__name__)
        return None


def _normalize_semantic(parsed: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(parsed, dict):
        return None
    label = str(parsed.get("soundLabel") or "").strip()
    description = str(parsed.get("description") or "").strip()
    if not label and not description:
        return None

    sources = _as_str_list(parsed.get("possibleSources"))
    events = _as_str_list(parsed.get("audibleEvents"))
    try:
        conf = float(parsed.get("confidence", 0.5))
    except (TypeError, ValueError):
        conf = 0.5
    conf = max(0.0, min(1.0, conf))

    return {
        "soundLabel": (label or description[:40])[:120],
        "description": (description or label)[:800],
        "possibleSources": sources[:12],
        "audibleEvents": events[:12],
        "confidence": round(conf, 3),
    }


def _as_str_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        s = value.strip()
        return [s] if s else []
    if isinstance(value, list):
        out: List[str] = []
        for item in value:
            s = str(item).strip()
            if s:
                out.append(s[:160])
        return out
    return []


def _parse_json_content(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        obj = json.loads(cleaned)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            return None
        try:
            obj = json.loads(match.group(0))
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
