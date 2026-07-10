from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.shared.llm.usage import record_ai_usage

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LLMTextResult:
    text: str
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class LLMClient:
    async def generate_text(self, *, system: str, prompt: str, feature: str = "unknown") -> LLMTextResult:  # pragma: no cover
        raise NotImplementedError


class OpenAIResponsesClient(LLMClient):
    """
    Uses OpenAI's Responses API via raw HTTP to avoid tight coupling to a specific SDK version.
    This client is used ONLY for narrative generation and explanations.
    """

    def __init__(self, *, user_id: str | None = None) -> None:
        self._settings = get_settings()
        self._user_id = user_id

    async def generate_text(self, *, system: str, prompt: str, feature: str = "unknown") -> LLMTextResult:
        if not self._settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not configured")

        headers = {"Authorization": f"Bearer {self._settings.openai_api_key}"}
        payload = {
            "model": self._settings.openai_model,
            # Long-form documents need more output room. This client is used only
            # for narrative generation; all numeric/calculation outputs are
            # blocked by guardrails upstream/downstream.
            "max_output_tokens": 9000,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": system}]},
                {"role": "user", "content": [{"type": "input_text", "text": prompt}]},
            ],
        }

        async with httpx.AsyncClient(timeout=900) as client:
            try:
                resp = await client.post("https://api.openai.com/v1/responses", json=payload, headers=headers)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                body = e.response.text if e.response is not None else ""
                raise RuntimeError(f"OpenAI API error {e.response.status_code if e.response else 'unknown'}: {body}") from e
            data = resp.json()

        text = ""
        if isinstance(data, dict):
            if isinstance(data.get("output_text"), str):
                text = data["output_text"]
            elif isinstance(data.get("output"), list):
                chunks: list[str] = []
                for item in data["output"]:
                    if not isinstance(item, dict):
                        continue
                    for c in item.get("content", []) if isinstance(item.get("content"), list) else []:
                        if isinstance(c, dict) and c.get("type") in ("output_text", "text"):
                            val = c.get("text") or c.get("value")
                            if isinstance(val, str):
                                chunks.append(val)
                text = "\n".join([c for c in chunks if c]).strip()

        text = text.strip()
        if not text:
            logger.warning("OpenAI response did not include output text; returning empty string")
        usage = data.get("usage") if isinstance(data, dict) and isinstance(data.get("usage"), dict) else {}
        input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
        total_tokens = int(usage.get("total_tokens") or (input_tokens + output_tokens))
        await record_ai_usage(
            user_id=self._user_id,
            feature=feature,
            provider="openai",
            model=self._settings.openai_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            request_id=data.get("id") if isinstance(data, dict) else None,
        )
        return LLMTextResult(
            text=text,
            provider="openai",
            model=self._settings.openai_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )


class NoopLLMClient(LLMClient):
    async def generate_text(self, *, system: str, prompt: str, feature: str = "unknown") -> LLMTextResult:
        return LLMTextResult(text="", provider="noop", model="none")


class AnthropicMessagesClient(LLMClient):
    """
    Minimal Anthropic Messages API client.
    Used ONLY for narrative generation and explanations.
    """

    def __init__(self, *, user_id: str | None = None) -> None:
        self._settings = get_settings()
        self._user_id = user_id

    async def generate_text(self, *, system: str, prompt: str, feature: str = "unknown") -> LLMTextResult:
        if not self._settings.claude_api_key:
            raise RuntimeError("CLAUDE_API_KEY not configured")

        headers = {
            "x-api-key": self._settings.claude_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": self._settings.claude_model,
            "max_tokens": 8000,
            "temperature": 0.5,
            "system": system,
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        }

        async with httpx.AsyncClient(timeout=900) as client:
            try:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                body = e.response.text if e.response is not None else ""
                raise RuntimeError(f"Anthropic API error {e.response.status_code if e.response else 'unknown'}: {body}") from e
            data = resp.json()

        text = ""
        if isinstance(data, dict) and isinstance(data.get("content"), list):
            chunks: list[str] = []
            for c in data["content"]:
                if isinstance(c, dict) and c.get("type") == "text" and isinstance(c.get("text"), str):
                    chunks.append(c["text"])
            text = "\n".join(chunks).strip()
        usage = data.get("usage") if isinstance(data, dict) and isinstance(data.get("usage"), dict) else {}
        input_tokens = int(usage.get("input_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or 0)
        total_tokens = input_tokens + output_tokens
        await record_ai_usage(
            user_id=self._user_id,
            feature=feature,
            provider="anthropic",
            model=self._settings.claude_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            request_id=data.get("id") if isinstance(data, dict) else None,
        )
        return LLMTextResult(
            text=text,
            provider="anthropic",
            model=self._settings.claude_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )


class GeminiGenerateClient(LLMClient):
    """
    Minimal Google Gemini API client.
    Used ONLY for narrative generation and explanations.
    """

    def __init__(self, *, user_id: str | None = None) -> None:
        self._settings = get_settings()
        self._user_id = user_id

    async def generate_text(self, *, system: str, prompt: str, feature: str = "unknown") -> LLMTextResult:
        if not self._settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY not configured")

        # Gemini uses an API key in the query string.
        model = self._settings.gemini_model
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": f"{system}\n\n{prompt}"}],
                }
            ],
            "generationConfig": {"temperature": 0.5, "maxOutputTokens": 8000},
        }

        async with httpx.AsyncClient(timeout=900) as client:
            try:
                resp = await client.post(url, params={"key": self._settings.gemini_api_key}, json=payload)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                body = e.response.text if e.response is not None else ""
                raise RuntimeError(f"Gemini API error {e.response.status_code if e.response else 'unknown'}: {body}") from e
            data = resp.json()

        text = ""
        if isinstance(data, dict) and isinstance(data.get("candidates"), list) and data["candidates"]:
            cand = data["candidates"][0]
            if isinstance(cand, dict):
                content = cand.get("content")
                if isinstance(content, dict) and isinstance(content.get("parts"), list):
                    chunks: list[str] = []
                    for p in content["parts"]:
                        if isinstance(p, dict) and isinstance(p.get("text"), str):
                            chunks.append(p["text"])
                    text = "\n".join(chunks).strip()
        usage = data.get("usageMetadata") if isinstance(data, dict) and isinstance(data.get("usageMetadata"), dict) else {}
        input_tokens = int(usage.get("promptTokenCount") or 0)
        output_tokens = int(usage.get("candidatesTokenCount") or 0)
        total_tokens = int(usage.get("totalTokenCount") or (input_tokens + output_tokens))
        await record_ai_usage(
            user_id=self._user_id,
            feature=feature,
            provider="gemini",
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )
        return LLMTextResult(
            text=text,
            provider="gemini",
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )


class AutoLLMClient(LLMClient):
    """
    Picks the best available LLM provider based on configured keys.
    Order: Claude -> OpenAI -> Gemini -> Noop

    This client is resilient: if a configured provider errors (network, auth, quota),
    it falls back to the next configured provider.
    """

    def __init__(self, *, user_id: str | None = None) -> None:
        self._settings = get_settings()
        self._clients: list[LLMClient] = []
        has_primary = False
        if self._settings.claude_api_key:
            self._clients.append(AnthropicMessagesClient(user_id=user_id))
            has_primary = True
        if self._settings.openai_api_key:
            self._clients.append(OpenAIResponsesClient(user_id=user_id))
            has_primary = True
        if self._settings.gemini_api_key and (not has_primary or self._settings.allow_gemini_fallback):
            self._clients.append(GeminiGenerateClient(user_id=user_id))
        if not self._clients:
            self._clients.append(NoopLLMClient())

    async def generate_text(self, *, system: str, prompt: str, feature: str = "unknown") -> LLMTextResult:
        last_err: Exception | None = None
        for c in self._clients:
            try:
                res = await c.generate_text(system=system, prompt=prompt, feature=feature)
                # Some providers can return an HTTP 200 but our parsing yields empty text.
                # Treat that as a failure so we can fall back to the next configured provider.
                if not (res.text or "").strip() and not isinstance(c, NoopLLMClient):
                    raise RuntimeError(f"{res.provider} returned empty text")
                return res
            except Exception as e:
                last_err = e
                continue
        if last_err:
            raise last_err
        return await NoopLLMClient().generate_text(system=system, prompt=prompt, feature=feature)


_FREE_PLAN_KEYS = {"free_trial", "explorer", "expired", ""}
_SERP_PLAN_KEYS = {"decision_engine", "growth_navigator", "strategic_business_os"}


async def get_user_plan_info(user_id: str) -> tuple[str, str]:
    """Return (plan_key, status) for the user. Falls back to ('', '') on error."""
    try:
        from app.core.supabase import sb_select
        sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
        return (sub or {}).get("plan_key") or "", (sub or {}).get("status") or ""
    except Exception:
        return "", ""


async def pick_llm_for_user(user_id: str) -> LLMClient:
    """Free/trial → OpenAI (gpt-4.1-mini). Paid → Claude (claude-3-5-sonnet). No fallback."""
    plan_key, status = await get_user_plan_info(user_id)
    is_free = plan_key in _FREE_PLAN_KEYS or status in {"trial", "expired"}
    return OpenAIResponsesClient(user_id=user_id) if is_free else AnthropicMessagesClient(user_id=user_id)


def plan_uses_serp(plan_key: str, status: str) -> bool:
    """SerpAPI search is only enabled for Pro+ plans (decision_engine and above)."""
    if status in {"trial", "expired"}:
        return False
    return plan_key in _SERP_PLAN_KEYS
