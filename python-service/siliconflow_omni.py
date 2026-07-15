"""SiliconFlow Qwen3-Omni — grayscale semantic recognition (5 natural-sound classes).

Uses SILICONFLOW_API_KEY / SILICONFLOW_OMNI_MODEL / SILICONFLOW_BASE_URL.
Qwen is the sole semantic source (no local classify fallback for semantic).
Does not modify strokePattern or brushParams (those stay on local acoustic path).
Never logs the API key.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import socket
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("siliconflow_omni")

DEFAULT_MODEL = "Qwen/Qwen3-Omni-30B-A3B-Instruct"
DEFAULT_BASE = "https://api.siliconflow.cn/v1"
REQUEST_TIMEOUT_SEC = 60.0

# Grayscale: same five classes as local natural_sound_archetypes
ARCHETYPE_IDS = (
    "birds",
    "wind_leaves",
    "water",
    "material_impact",
    "insects_amphibians",
)
ARCHETYPE_LABELS_ZH = {
    "birds": "鸟类",
    "wind_leaves": "风与树叶",
    "water": "水",
    "material_impact": "自然材质交互",
    "insects_amphibians": "昆虫与两栖动物",
}

PROMPT = (
    "你在做灰度测试：请把这段自然声录音归入下列五类之一（必须选一类）。\n"
    "birds — 鸟鸣、啾啾、间歇短脉冲、静音多\n"
    "wind_leaves — 风声、树叶沙沙、连续噪声纹理\n"
    "water — 流水、滴水、浪花、柔和起伏\n"
    "material_impact — 敲击、碰撞、折断、突发冲击后衰减\n"
    "insects_amphibians — 虫鸣、蝉鸣、蛙叫、规律重复脉冲\n"
    "若混合声，选最突出的一类；不确定时仍选最接近的一类并降低 confidence。\n"
    "只返回 JSON，不要 markdown，不要其它文字：\n"
    "{\n"
    '  "archetype": "birds|wind_leaves|water|material_impact|insects_amphibians",\n'
    '  "soundLabel": "与该类对应的短标签（可用中文）",\n'
    '  "description": "对听到内容的客观描述",\n'
    '  "possibleSources": ["可能的声源1", "可能的声源2"],\n'
    '  "audibleEvents": ["可听事件1", "可听事件2"],\n'
    '  "confidence": 0.0\n'
    "}\n"
    "confidence 为 0~1。"
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
        "soleSemanticSource": "qwen3-omni",
        "grayscaleArchetypes": list(ARCHETYPE_IDS),
    }


def _error(code: str, detail: str = "") -> Dict[str, str]:
    out = {"code": code, "message": "声音识别失败，请重试"}
    if detail:
        out["detail"] = detail[:120]
    return out


def analyze_semantic(
    wav_bytes: bytes,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, str]]]:
    """Call Qwen3-Omni for 5-class grayscale semantic recognition.

    Returns (semantic, None) on success, or (None, semanticError) on failure.
    """
    if not wav_bytes:
        return None, _error("empty_audio")

    if not is_configured():
        return None, _error("not_configured")

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
                    "content": (
                        "你是自然声音五类分类助手（灰度测试）。"
                        "只能输出 JSON，archetype 必须是五类之一。"
                    ),
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
            return None, _error("invalid_response")
        normalized["model"] = model
        normalized["provider"] = "siliconflow"
        return normalized, None
    except socket.timeout:
        logger.warning("Omni semantic timeout")
        return None, _error("timeout")
    except TimeoutError:
        logger.warning("Omni semantic timeout")
        return None, _error("timeout")
    except urllib.error.URLError as exc:
        reason = type(getattr(exc, "reason", None) or exc).__name__
        if "timed out" in str(exc).lower() or reason in ("timeout", "TimeoutError"):
            logger.warning("Omni semantic timeout")
            return None, _error("timeout")
        logger.warning("Omni semantic URL error type=%s", reason)
        return None, _error("network_error")
    except urllib.error.HTTPError as exc:
        logger.warning("Omni semantic HTTP error status=%s", exc.code)
        return None, _error("http_error", f"status_{exc.code}")
    except Exception as exc:
        logger.warning("Omni semantic failed: %s", type(exc).__name__)
        return None, _error("exception", type(exc).__name__)


def _normalize_semantic(parsed: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(parsed, dict):
        return None

    raw_arch = str(parsed.get("archetype") or "").strip().lower().replace("-", "_").replace(" ", "_")
    # light aliasing for common mistakes
    aliases = {
        "bird": "birds",
        "wind": "wind_leaves",
        "leaves": "wind_leaves",
        "leaf": "wind_leaves",
        "impact": "material_impact",
        "material": "material_impact",
        "insect": "insects_amphibians",
        "insects": "insects_amphibians",
        "amphibian": "insects_amphibians",
        "amphibians": "insects_amphibians",
    }
    archetype = aliases.get(raw_arch, raw_arch)
    if archetype not in ARCHETYPE_IDS:
        return None

    label = str(parsed.get("soundLabel") or "").strip()
    description = str(parsed.get("description") or "").strip()
    if not label:
        label = ARCHETYPE_LABELS_ZH.get(archetype, archetype)
    if not description:
        description = label

    sources = _as_str_list(parsed.get("possibleSources"))
    events = _as_str_list(parsed.get("audibleEvents"))
    try:
        conf = float(parsed.get("confidence", 0.5))
    except (TypeError, ValueError):
        conf = 0.5
    conf = max(0.0, min(1.0, conf))

    return {
        "archetype": archetype,
        "archetypeLabelZh": ARCHETYPE_LABELS_ZH[archetype],
        "soundLabel": label[:120],
        "description": description[:800],
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
