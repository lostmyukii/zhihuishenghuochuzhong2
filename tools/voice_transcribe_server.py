#!/usr/bin/env python3
"""HTTPS-reverse-proxied voice service for the context detective dashboard.

The service converts a short browser recording to text, then maps natural
Chinese text to a small project-specific intent contract. Provider secrets stay
in the server process environment and are never returned to the browser.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
from email import policy
from email.parser import BytesParser
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


PROJECT_ID = "smartlife-junior-context"
PROFILE_ID = "smartlife-junior-context-detective-v1"
DEFAULT_MAX_BYTES = 8 * 1024 * 1024
XUNFEI_IAT_HOST = "iat-api.xfyun.cn"
XUNFEI_IAT_PATH = "/v2/iat"
XUNFEI_SPARK_HOST = "spark-api.xf-yun.com"
XUNFEI_SPARK_PATH = "/v4.0/chat"
XUNFEI_SPARK_DOMAIN = "4.0Ultra"
ALLOWED_MODES = {"detect", "study", "rest", "ventilation", "energy", "custom"}
QUERY_INTENTS = {"queryContext", "explainContext", "querySafety"}
CONTROL_INTENTS = {"setMode", "confirmContext", "correctContext", "setThreshold", "muteBuzzer"}
ALLOWED_INTENTS = QUERY_INTENTS | CONTROL_INTENTS | {"unknown"}
THRESHOLD_RULES: dict[str, tuple[float, float, float]] = {
    "lightThreshold": (0, 4095, 100),
    "soundThreshold": (0, 4095, 50),
    "temperatureThreshold": (10, 45, 1),
    "humidityThreshold": (20, 95, 5),
    # Voice can never raise the provisional MQ2 threshold above the safe baseline.
    "mq2Threshold": (0, 2600, 50),
}


class VoiceServiceError(RuntimeError):
    def __init__(self, status: int, code: str, message: str, detail: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail


def json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _complete_xunfei_credentials(env: dict[str, str]) -> bool:
    return bool(env.get("XFYUN_APP_ID") and env.get("XFYUN_API_KEY") and env.get("XFYUN_API_SECRET"))


def env_provider(env: dict[str, str] | None = None) -> str:
    env = env or os.environ
    explicit = (env.get("VOICE_TRANSCRIBE_PROVIDER") or "").strip().lower()
    if explicit:
        return explicit
    return "xunfei" if _complete_xunfei_credentials(env) else "disabled"


def provider_configured(provider: str, env: dict[str, str] | None = None) -> bool:
    env = env or os.environ
    if provider == "mock":
        return True
    if provider == "xunfei":
        return _complete_xunfei_credentials(env)
    return provider == "disabled"


def intent_provider(env: dict[str, str] | None = None) -> str:
    env = env or os.environ
    explicit = (env.get("VOICE_INTENT_PROVIDER") or "").strip().lower()
    if explicit:
        return explicit
    return "xunfei-spark-ws" if _complete_xunfei_credentials(env) else "rules"


def intent_provider_configured(provider: str, env: dict[str, str] | None = None) -> bool:
    env = env or os.environ
    if provider in {"rules", "mock", "disabled"}:
        return True
    if provider == "xunfei-spark-ws":
        return _complete_xunfei_credentials(env)
    return False


def health_payload(env: dict[str, str] | None = None, *, ffmpeg_available: bool | None = None) -> dict[str, Any]:
    env = env or os.environ
    transcribe = env_provider(env)
    intent = intent_provider(env)
    if ffmpeg_available is None:
        ffmpeg_available = bool(shutil.which(env.get("FFMPEG_BIN", "ffmpeg")))
    return {
        "ok": True,
        "service": "smartlife-context-voice",
        "project": PROJECT_ID,
        "profileId": PROFILE_ID,
        "transcribeProvider": transcribe,
        "transcribeConfigured": provider_configured(transcribe, env),
        "intentProvider": intent,
        "intentConfigured": intent_provider_configured(intent, env),
        "ffmpeg": bool(ffmpeg_available),
        "ts": int(time.time() * 1000),
    }


def allowed_origins(env: dict[str, str] | None = None) -> set[str]:
    env = env or os.environ
    raw = env.get("VOICE_ALLOWED_ORIGINS", "http://127.0.0.1:18767,http://localhost:18767")
    return {item.strip().rstrip("/") for item in raw.split(",") if item.strip()}


def origin_allowed(origin: str, env: dict[str, str] | None = None) -> bool:
    if not origin:
        return False
    return origin.rstrip("/") in allowed_origins(env)


class RateLimiter:
    """Small in-process fixed-window limiter for the voice POST endpoints."""

    def __init__(self) -> None:
        self._events: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, *, limit: int, window_seconds: float, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        cutoff = now - window_seconds
        with self._lock:
            events = [value for value in self._events.get(key, []) if value >= cutoff]
            if len(events) >= limit:
                self._events[key] = events
                return False
            events.append(now)
            self._events[key] = events
            return True


RATE_LIMITER = RateLimiter()


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _confidence(value: Any, default: float = 0.5) -> float:
    number = _number(value)
    return max(0.0, min(1.0, number if number is not None else default))


def _mode_from_text(text: str) -> str | None:
    rules = [
        ("ventilation", r"通风|换气|湿热|有点闷|太闷|空气不舒服"),
        ("study", r"学习|写作业|专心|专注"),
        ("rest", r"休息|睡觉|安静|低扰"),
        ("energy", r"节能|省电|无人|没人|离开|出门"),
        ("custom", r"自定义|我的情境"),
        ("detect", r"实时侦测|返回侦测|侦探模式|全部检查"),
    ]
    for mode, pattern in rules:
        if re.search(pattern, text):
            return mode
    return None


def _threshold_key(text: str) -> str | None:
    mappings = [
        ("temperatureThreshold", r"温度.*阈值|阈值.*温度"),
        ("humidityThreshold", r"湿度.*阈值|阈值.*湿度"),
        ("soundThreshold", r"声音.*阈值|噪音.*阈值|阈值.*声音"),
        ("lightThreshold", r"光照.*阈值|亮度.*阈值|阈值.*光"),
        ("mq2Threshold", r"MQ2.*阈值|烟雾.*阈值|燃气.*阈值"),
    ]
    for key, pattern in mappings:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return key
    return None


def infer_rule_voice_intent(text: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    context = context or {}
    compact = "".join(str(text or "").split())
    if not compact:
        return {"intent": "unknown", "confidence": 0.0, "reason": "empty"}

    if re.search(r"为什么|依据|支持证据|反向证据|缺少什么|怎么判断", compact):
        return {"intent": "explainContext", "confidence": 0.88, "reason": "情境依据查询"}
    if re.search(r"安全.*(异常|风险|怎么样|查询)|有没有.*(危险|报警)|家里安全吗", compact):
        return {"intent": "querySafety", "confidence": 0.9, "reason": "安全状态查询"}
    if re.search(r"最可能.*情境|什么情境|当前情境|现在是什么状态", compact):
        return {"intent": "queryContext", "confidence": 0.88, "reason": "当前情境查询"}

    if re.search(r"不正确|判断错|不是这个|纠正", compact):
        mode = _mode_from_text(compact)
        if mode:
            return {"intent": "correctContext", "mode": mode, "confidence": 0.9, "reason": "用户纠正情境"}
    if re.search(r"确认.*判断|判断正确|就是这个情境|同意当前", compact):
        candidate = context.get("candidate")
        if candidate in ALLOWED_MODES:
            return {"intent": "confirmContext", "candidate": candidate, "confidence": 0.9, "reason": "用户确认候选情境"}

    threshold = _threshold_key(compact)
    if threshold:
        low, high, step = THRESHOLD_RULES[threshold]
        numbers = re.findall(r"(?<![A-Za-z])\d+(?:\.\d+)?", compact)
        value: float | None = float(numbers[-1]) if numbers else None
        thresholds = context.get("thresholds") if isinstance(context.get("thresholds"), dict) else {}
        if value is None:
            current = _number(thresholds.get(threshold))
            if current is not None and re.search(r"调高|提高|增加|大一点", compact):
                value = current + step
            elif current is not None and re.search(r"调低|降低|减少|小一点", compact):
                value = current - step
        if value is not None and low <= value <= high:
            normalized: int | float = int(value) if value.is_integer() else value
            return {
                "intent": "setThreshold",
                "settings": {threshold: normalized},
                "confidence": 0.84,
                "reason": "阈值调整",
            }
        return {"intent": "unknown", "confidence": 0.25, "reason": "阈值缺少当前值或超出安全范围"}

    if re.search(r"蜂鸣|报警", compact) and re.search(r"静音|不要响|关闭声音|别叫|消音", compact):
        return {"intent": "muteBuzzer", "confidence": 0.92, "reason": "明确蜂鸣静音"}

    mode = _mode_from_text(compact)
    if mode:
        return {"intent": "setMode", "mode": mode, "confidence": 0.86, "reason": "情境切换表达"}
    return {"intent": "unknown", "confidence": 0.2, "reason": "未命中安全白名单"}


def fallback_reply(result: dict[str, Any]) -> str:
    intent = result.get("intent")
    if intent == "queryContext":
        return "我会根据当前新鲜证据汇总可能情境。"
    if intent == "explainContext":
        return "我会展示支持证据、反向证据和缺失证据。"
    if intent == "querySafety":
        return "我会读取开发板当前上报的安全状态。"
    if intent == "setMode":
        return "已生成情境切换请求，等待开发板确认。"
    if intent == "confirmContext":
        return "已生成情境确认请求，等待开发板确认。"
    if intent == "correctContext":
        return "已生成情境纠正请求，等待开发板确认。"
    if intent == "setThreshold":
        return "已生成阈值调整请求，等待开发板确认。"
    if intent == "muteBuzzer":
        return "已生成蜂鸣静音请求，安全状态仍会保留。"
    return "没有匹配到安全白名单中的操作。"


def sanitize_voice_intent(
    candidate: Any,
    text: str = "",
    provider: str = "rules",
    model: str = "rules-v1",
) -> dict[str, Any]:
    source = candidate if isinstance(candidate, dict) else {}
    intent = source.get("intent") if source.get("intent") in ALLOWED_INTENTS else "unknown"
    confidence = _confidence(source.get("confidence"), 0.5)
    result: dict[str, Any] = {
        "ok": True,
        "type": "voiceIntent",
        "project": PROJECT_ID,
        "profileId": PROFILE_ID,
        "text": str(text or "")[:500],
        "intent": intent,
        "confidence": confidence,
        "provider": provider,
        "model": model,
        "safe": True,
        "reason": str(source.get("reason") or "")[:160],
    }

    if intent == "setMode":
        if source.get("mode") not in ALLOWED_MODES:
            result["intent"] = "unknown"
        else:
            result["mode"] = source["mode"]
    elif intent == "confirmContext":
        if source.get("candidate") not in ALLOWED_MODES:
            result["intent"] = "unknown"
        else:
            result["candidate"] = source["candidate"]
    elif intent == "correctContext":
        if source.get("mode") not in ALLOWED_MODES:
            result["intent"] = "unknown"
        else:
            result["mode"] = source["mode"]
    elif intent == "setThreshold":
        settings = source.get("settings")
        if not isinstance(settings, dict) or len(settings) != 1:
            result["intent"] = "unknown"
        else:
            key, value = next(iter(settings.items()))
            numeric = _number(value)
            rule = THRESHOLD_RULES.get(key)
            if not rule or numeric is None or not rule[0] <= numeric <= rule[1]:
                result["intent"] = "unknown"
            else:
                result["settings"] = {key: int(numeric) if numeric.is_integer() else numeric}

    if result["intent"] in CONTROL_INTENTS and confidence < 0.6:
        result["intent"] = "unknown"
        result.pop("mode", None)
        result.pop("candidate", None)
        result.pop("settings", None)

    if result["intent"] == "unknown":
        result["confidence"] = min(confidence, 0.35)
        result.pop("mode", None)
        result.pop("candidate", None)
        result.pop("settings", None)
        if not result["reason"]:
            result["reason"] = "意图不在白名单或参数无效"
    result["reply"] = str(source.get("reply") or fallback_reply(result))[:200]
    return result


def extract_first_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    text = str(value or "").strip()
    if not text:
        raise ValueError("empty response")
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("json object not found")


def _safe_context(context: dict[str, Any] | None) -> dict[str, Any]:
    context = context or {}
    allowed = ("fresh", "mode", "candidate", "coverage", "match", "alerts", "thresholds", "sensors")
    result = {key: context[key] for key in allowed if key in context}
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    if len(encoded) > 1400:
        result.pop("sensors", None)
    return result


def build_spark_request(app_id: str, text: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    system = (
        "你是N16R8无摄像头家庭情境侦探屋的安全意图解析器。"
        "只输出一个JSON对象，不输出Markdown。"
        "白名单意图只有queryContext,explainContext,setMode,confirmContext,correctContext,"
        "setThreshold,querySafety,muteBuzzer,unknown。"
        "setMode和correctContext模式只能是detect,study,rest,ventilation,energy,custom。"
        "setThreshold.settings只能包含一个允许阈值。禁止输出GPIO、PWM、舵机角度、继电器或任意执行器命令。"
        "不确定、低置信度或参数不足时必须输出unknown，不能强行猜测动作。"
    )
    user = json.dumps({"text": str(text)[:500], "context": _safe_context(context)}, ensure_ascii=False)
    return {
        "header": {"app_id": app_id, "uid": "context-detective"},
        "parameter": {"chat": {"domain": XUNFEI_SPARK_DOMAIN, "temperature": 0.1, "max_tokens": 512}},
        "payload": {
            "message": {
                "text": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ]
            }
        },
    }


def xunfei_auth_url(api_key: str, api_secret: str, *, host: str, path: str) -> str:
    date = formatdate(timeval=None, localtime=False, usegmt=True)
    signature_origin = f"host: {host}\ndate: {date}\nGET {path} HTTP/1.1"
    signature = base64.b64encode(
        hmac.new(api_secret.encode(), signature_origin.encode(), hashlib.sha256).digest()
    ).decode()
    authorization_origin = (
        f'api_key="{api_key}", algorithm="hmac-sha256", '
        f'headers="host date request-line", signature="{signature}"'
    )
    authorization = base64.b64encode(authorization_origin.encode()).decode()
    query = urllib.parse.urlencode({"authorization": authorization, "date": date, "host": host})
    return f"wss://{host}{path}?{query}"


def xunfei_words_from_result(encoded_text: str) -> str:
    try:
        payload = json.loads(base64.b64decode(encoded_text).decode("utf-8"))
    except Exception as exc:
        raise VoiceServiceError(502, "xunfei_result_invalid", "讯飞识别结果无法解析") from exc
    return xunfei_words_from_legacy_result(payload)


def xunfei_words_from_legacy_result(result: dict[str, Any]) -> str:
    words: list[str] = []
    for item in result.get("ws") or []:
        candidates = item.get("cw") or []
        if candidates:
            words.append(str(candidates[0].get("w") or ""))
    return "".join(words)


async def transcribe_xunfei_legacy_async(pcm: bytes, env: dict[str, str] | None = None) -> dict[str, Any]:
    env = env or os.environ
    if not _complete_xunfei_credentials(env):
        raise VoiceServiceError(503, "stt_not_configured", "服务器未配置讯飞语音听写")
    try:
        import websockets
    except ImportError as exc:
        raise VoiceServiceError(503, "websockets_missing", "服务器缺少websockets依赖") from exc

    url = xunfei_auth_url(
        env["XFYUN_API_KEY"], env["XFYUN_API_SECRET"], host=XUNFEI_IAT_HOST, path=XUNFEI_IAT_PATH
    )
    frame_size = int(env.get("XFYUN_FRAME_SIZE", "1280"))
    interval = float(env.get("XFYUN_FRAME_INTERVAL", "0.04"))
    timeout = float(env.get("VOICE_TRANSCRIBE_TIMEOUT", "25"))
    chunks = [pcm[index : index + frame_size] for index in range(0, len(pcm), frame_size)]
    if not chunks:
        raise VoiceServiceError(400, "empty_audio", "音频为空")
    parts: list[str] = []
    async with websockets.connect(url, open_timeout=timeout, close_timeout=5, max_size=2 * 1024 * 1024) as websocket:
        for index, chunk in enumerate(chunks):
            status = 0 if index == 0 else 1
            message: dict[str, Any] = {
                "data": {
                    "status": status,
                    "format": "audio/L16;rate=16000",
                    "encoding": "raw",
                    "audio": base64.b64encode(chunk).decode(),
                }
            }
            if index == 0:
                message["common"] = {"app_id": env["XFYUN_APP_ID"]}
                message["business"] = {
                    "language": "zh_cn",
                    "domain": "iat",
                    "accent": "mandarin",
                    "vad_eos": int(env.get("XFYUN_EOS", "3000")),
                    "dwa": "wpgs",
                }
            await websocket.send(json.dumps(message, ensure_ascii=False))
            await asyncio.sleep(interval)
        await websocket.send(
            json.dumps(
                {"data": {"status": 2, "format": "audio/L16;rate=16000", "encoding": "raw", "audio": ""}},
                ensure_ascii=False,
            )
        )
        while True:
            response = json.loads(await asyncio.wait_for(websocket.recv(), timeout=timeout))
            if int(response.get("code", 0)) != 0:
                raise VoiceServiceError(502, "xunfei_upstream_error", "讯飞语音听写返回错误")
            data = response.get("data") or {}
            result = data.get("result") or {}
            text = xunfei_words_from_legacy_result(result) if result else ""
            if text:
                if result.get("pgs") == "rpl" and isinstance(result.get("rg"), list) and len(result["rg"]) == 2:
                    start, end = result["rg"]
                    parts[start - 1 : end] = [text]
                else:
                    parts.append(text)
            if int(data.get("status", 0)) == 2:
                break
    text = "".join(parts).strip()
    if not text:
        raise VoiceServiceError(502, "empty_transcript", "讯飞语音识别没有返回文字")
    return {"ok": True, "text": text, "provider": "xunfei", "model": "iat-v2", "language": "zh_cn"}


async def call_xunfei_spark_intent_async(
    text: str, context: dict[str, Any] | None = None, env: dict[str, str] | None = None
) -> dict[str, Any]:
    env = env or os.environ
    if not _complete_xunfei_credentials(env):
        raise VoiceServiceError(503, "intent_not_configured", "服务器未配置讯飞星火意图解析")
    try:
        import websockets
    except ImportError as exc:
        raise VoiceServiceError(503, "websockets_missing", "服务器缺少websockets依赖") from exc
    url = xunfei_auth_url(
        env["XFYUN_API_KEY"], env["XFYUN_API_SECRET"], host=XUNFEI_SPARK_HOST, path=XUNFEI_SPARK_PATH
    )
    timeout = float(env.get("VOICE_INTENT_TIMEOUT", "15"))
    request = build_spark_request(env["XFYUN_APP_ID"], text, context)
    chunks: list[str] = []
    async with websockets.connect(url, open_timeout=timeout, close_timeout=5, max_size=2 * 1024 * 1024) as websocket:
        await websocket.send(json.dumps(request, ensure_ascii=False))
        while True:
            response = json.loads(await asyncio.wait_for(websocket.recv(), timeout=timeout))
            header = response.get("header") or {}
            if int(header.get("code", 0)) != 0:
                raise VoiceServiceError(502, "spark_upstream_error", "讯飞星火意图解析返回错误")
            choices = ((response.get("payload") or {}).get("choices") or {})
            for item in choices.get("text") or []:
                chunks.append(str(item.get("content") or ""))
            if int(header.get("status", choices.get("status", 0))) == 2:
                break
    try:
        candidate = extract_first_json_object("".join(chunks))
    except ValueError as exc:
        raise VoiceServiceError(502, "spark_invalid_json", "讯飞星火没有返回合法意图JSON") from exc
    return sanitize_voice_intent(candidate, text, "xunfei-spark-ws", XUNFEI_SPARK_DOMAIN)


def resolve_voice_intent(
    text: str,
    context: dict[str, Any] | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    env = env or os.environ
    provider = intent_provider(env)
    if provider == "mock":
        candidate = extract_first_json_object(
            env.get("VOICE_INTENT_MOCK_JSON", '{"intent":"setMode","mode":"detect","confidence":0.95}')
        )
        return sanitize_voice_intent(candidate, text, "mock", "mock")
    if provider in {"rules", "disabled"}:
        return sanitize_voice_intent(infer_rule_voice_intent(text, context), text, "rules", "rules-v1")
    if provider == "xunfei-spark-ws":
        try:
            upstream = asyncio.run(call_xunfei_spark_intent_async(text, context, env))
            if upstream.get("intent") != "unknown" or env.get("VOICE_INTENT_ALLOW_RULE_FALLBACK", "1") == "0":
                return upstream
            fallback = sanitize_voice_intent(
                infer_rule_voice_intent(text, context), text, "rules-fallback", "rules-v1"
            )
            if fallback.get("intent") == "unknown":
                return upstream
            fallback["degraded"] = True
            fallback["fallbackReason"] = "model_unknown"
            return fallback
        except (VoiceServiceError, OSError, asyncio.TimeoutError):
            if env.get("VOICE_INTENT_ALLOW_RULE_FALLBACK", "1") == "0":
                raise
            fallback = infer_rule_voice_intent(text, context)
            result = sanitize_voice_intent(fallback, text, "rules-fallback", "rules-v1")
            result["degraded"] = True
            return result
    raise VoiceServiceError(503, "intent_provider_unknown", "未知的语音意图解析供应商")


def convert_audio_to_pcm(
    audio: bytes,
    filename: str,
    content_type: str,
    env: dict[str, str] | None = None,
) -> bytes:
    env = env or os.environ
    ffmpeg = env.get("FFMPEG_BIN", "ffmpeg")
    if not shutil.which(ffmpeg):
        raise VoiceServiceError(503, "ffmpeg_missing", "服务器缺少ffmpeg")
    suffix = os.path.splitext(filename or "")[1] or ".webm"
    with tempfile.TemporaryDirectory(prefix="context-voice-") as directory:
        source = os.path.join(directory, "input" + suffix)
        target = os.path.join(directory, "audio.pcm")
        with open(source, "wb") as handle:
            handle.write(audio)
        completed = subprocess.run(
            [ffmpeg, "-nostdin", "-loglevel", "error", "-y", "-i", source, "-ac", "1", "-ar", "16000", "-f", "s16le", target],
            capture_output=True,
            timeout=float(env.get("FFMPEG_TIMEOUT", "15")),
            check=False,
        )
        if completed.returncode != 0 or not os.path.exists(target):
            raise VoiceServiceError(400, "audio_convert_failed", "浏览器录音无法转换为语音识别格式")
        with open(target, "rb") as handle:
            pcm = handle.read()
    if not pcm:
        raise VoiceServiceError(400, "empty_audio", "录音转换后为空")
    return pcm


def transcribe_audio(
    audio: bytes,
    filename: str,
    content_type: str,
    language: str = "zh",
    prompt: str = "",
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    env = env or os.environ
    provider = env_provider(env)
    if provider == "mock":
        return {
            "ok": True,
            "text": env.get("VOICE_TRANSCRIBE_MOCK_TEXT", "进入实时侦测"),
            "provider": "mock",
            "model": "mock",
            "language": language,
        }
    if provider == "xunfei":
        pcm = convert_audio_to_pcm(audio, filename, content_type, env)
        return asyncio.run(transcribe_xunfei_legacy_async(pcm, env))
    raise VoiceServiceError(503, "stt_not_configured", "服务器语音转文字未配置")


def _read_body(handler: BaseHTTPRequestHandler, max_bytes: int) -> bytes:
    try:
        size = int(handler.headers.get("Content-Length") or "0")
    except ValueError as exc:
        raise VoiceServiceError(400, "invalid_content_length", "请求长度无效") from exc
    if size <= 0:
        raise VoiceServiceError(400, "empty_request", "没有收到请求数据")
    if size > max_bytes:
        raise VoiceServiceError(413, "request_too_large", "请求数据太大")
    return handler.rfile.read(size)


def parse_json_body(handler: BaseHTTPRequestHandler, max_bytes: int = 64 * 1024) -> dict[str, Any]:
    try:
        payload = json.loads(_read_body(handler, max_bytes).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VoiceServiceError(400, "invalid_json", "JSON解析失败") from exc
    if not isinstance(payload, dict):
        raise VoiceServiceError(400, "invalid_json", "请求必须是JSON对象")
    return payload


def parse_multipart_audio(handler: BaseHTTPRequestHandler, max_bytes: int) -> tuple[bytes, str, str, str, str]:
    content_type = handler.headers.get("Content-Type", "")
    if "multipart/form-data" not in content_type:
        raise VoiceServiceError(415, "multipart_required", "语音接口需要multipart/form-data")
    body = _read_body(handler, max_bytes)
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
    )
    audio = b""
    filename = "speech.webm"
    audio_type = "audio/webm"
    language = "zh"
    prompt = ""
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        value = part.get_payload(decode=True) or b""
        if name == "audio":
            audio = value
            filename = part.get_filename() or filename
            audio_type = part.get_content_type() or audio_type
        elif name == "language":
            language = value.decode("utf-8", errors="replace")[:16]
        elif name == "prompt":
            prompt = value.decode("utf-8", errors="replace")[:500]
    if not audio:
        raise VoiceServiceError(400, "empty_audio", "没有收到音频")
    return audio, filename, audio_type, language, prompt


class VoiceHandler(BaseHTTPRequestHandler):
    server_version = "SmartLifeContextVoice/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"voice-http status={args[1] if len(args) > 1 else '-'}", flush=True)

    def _cors_origin(self) -> str | None:
        origin = self.headers.get("Origin", "")
        return origin if origin_allowed(origin) else None

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _origin_ok(self) -> bool:
        if os.environ.get("VOICE_REQUIRE_ORIGIN", "1") == "0":
            return True
        return origin_allowed(self.headers.get("Origin", ""))

    def _rate_ok(self) -> bool:
        limit = int(os.environ.get("VOICE_RATE_LIMIT", "20"))
        window = float(os.environ.get("VOICE_RATE_WINDOW", "60"))
        forwarded = self.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
        client = forwarded or self.client_address[0]
        return RATE_LIMITER.allow(client, limit=limit, window_seconds=window)

    def do_OPTIONS(self) -> None:
        if not self._origin_ok():
            self._send_json(403, {"ok": False, "error": "origin_forbidden"})
            return
        self._send_json(204, {})

    def do_GET(self) -> None:
        if urllib.parse.urlparse(self.path).path != "/api/voice/health":
            self._send_json(404, {"ok": False, "error": "not_found"})
            return
        self._send_json(200, health_payload())

    def do_POST(self) -> None:
        request_id = f"voice-{int(time.time() * 1000)}"
        if not self._origin_ok():
            self._send_json(403, {"ok": False, "error": "origin_forbidden", "requestId": request_id})
            return
        if not self._rate_ok():
            self._send_json(429, {"ok": False, "error": "rate_limited", "requestId": request_id})
            return
        path = urllib.parse.urlparse(self.path).path
        started = time.monotonic()
        try:
            if path == "/api/voice/transcribe":
                max_bytes = int(os.environ.get("VOICE_TRANSCRIBE_MAX_BYTES", str(DEFAULT_MAX_BYTES)))
                audio, filename, content_type, language, prompt = parse_multipart_audio(self, max_bytes)
                result = transcribe_audio(audio, filename, content_type, language, prompt)
                result.update({"requestId": request_id, "bytes": len(audio), "ts": int(time.time() * 1000)})
                result_type = "transcribe"
            elif path == "/api/voice/intent":
                payload = parse_json_body(self)
                if payload.get("project") != PROJECT_ID or payload.get("profileId") != PROFILE_ID:
                    raise VoiceServiceError(400, "identity_mismatch", "项目或画像不匹配")
                text = str(payload.get("text") or "").strip()
                if not text:
                    raise VoiceServiceError(400, "empty_text", "没有收到可解析的文本")
                context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
                result = resolve_voice_intent(text, context)
                result.update({"requestId": request_id, "ts": int(time.time() * 1000)})
                result_type = "intent"
            else:
                self._send_json(404, {"ok": False, "error": "not_found", "requestId": request_id})
                return
            elapsed = int((time.monotonic() - started) * 1000)
            print(f"voice-request id={request_id} kind={result_type} ok=1 elapsed_ms={elapsed}", flush=True)
            self._send_json(200, result)
        except VoiceServiceError as exc:
            elapsed = int((time.monotonic() - started) * 1000)
            print(f"voice-request id={request_id} ok=0 code={exc.code} elapsed_ms={elapsed}", flush=True)
            self._send_json(exc.status, {"ok": False, "error": exc.code, "message": exc.message, "requestId": request_id})
        except Exception:
            elapsed = int((time.monotonic() - started) * 1000)
            print(f"voice-request id={request_id} ok=0 code=internal_error elapsed_ms={elapsed}", flush=True)
            self._send_json(500, {"ok": False, "error": "internal_error", "message": "语音服务内部错误", "requestId": request_id})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Context detective browser voice service")
    parser.add_argument("--host", default=os.getenv("VOICE_TRANSCRIBE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("VOICE_TRANSCRIBE_PORT", "19468")))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    server = ThreadingHTTPServer((args.host, args.port), VoiceHandler)
    print(f"Context voice service listening http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
