"""Claude through the official Anthropic SDK: Console API key, server identity or Amazon Bedrock."""

from __future__ import annotations

import base64
import json
from typing import Any, AsyncIterator

import anthropic

from .base import MAX_TURN_TOKENS, Provider
from .errors import AIError, translate
from .types import Part, Pdf, Structured, ToolCall, Turn

DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"  # Claude API only; Bedrock has no server-side fallback


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self, credentials: dict, timeout: float = 300.0, effort: str = "low"):
        self.method = credentials.get("auth_method") or "api_key"
        self.credentials = credentials
        self.timeout = timeout
        self.effort = effort  # for conversation turns; structured requests use "medium"
        model = (credentials.get("model") or "").strip() or DEFAULT_MODEL

        if self.method == "api_key":
            if not credentials.get("api_key"):
                raise AIError("not_configured", "No Claude API key is saved. An admin must add one on the Connections page.")
        elif self.method == "bedrock":
            if not (credentials.get("bedrock_region") or "").strip():
                raise AIError("not_configured", "Amazon Bedrock is selected, but no AWS region is saved.")
            model = model if model.startswith("anthropic.") else f"anthropic.{model}"
        elif self.method != "server_identity":
            raise AIError("not_configured", f"Unsupported Claude connection method: {self.method}.")

        self.model = model
        self.label = "Claude (Amazon Bedrock)" if self.method == "bedrock" else "Claude"
        self._clients: dict[bool, Any] = {}

    @property
    def supports_server_fallback(self) -> bool:
        return self.method != "bedrock"

    def client(self, async_client: bool = False):
        if async_client not in self._clients:
            self._clients[async_client] = self._make_client(async_client)
        return self._clients[async_client]

    def _make_client(self, async_client: bool):
        options = {"timeout": self.timeout, "max_retries": 1}
        if self.method == "bedrock":
            cls = anthropic.AsyncAnthropicBedrockMantle if async_client else anthropic.AnthropicBedrockMantle
            return cls(
                aws_region=self.credentials["bedrock_region"].strip(),
                # Empty keys fall back to the server's IAM role / default AWS credential chain.
                aws_access_key=self.credentials.get("bedrock_access_key_id") or None,
                aws_secret_key=self.credentials.get("bedrock_secret_access_key") or None,
                **options,
            )
        cls = anthropic.AsyncAnthropic if async_client else anthropic.Anthropic
        if self.method == "api_key":
            return cls(api_key=self.credentials["api_key"], **options)
        try:
            # Server identity: the SDK resolves ANTHROPIC_API_KEY, then Workload Identity Federation env vars.
            return cls(**options)
        except Exception as error:  # noqa: BLE001 - surfaced as a configuration problem
            raise AIError(
                "not_configured",
                "Server identity is selected, but no Claude credentials are configured on this service "
                "(Workload Identity Federation or ANTHROPIC_API_KEY). Ask DevOps to configure them.",
            ) from error

    def ping(self) -> str:
        # A one-token request, not just a model lookup: a valid key with no credit left would pass a
        # lookup and then fail every real request, and the status must not claim it works.
        try:
            message = self.client().messages.create(model=self.model, max_tokens=1, messages=[{"role": "user", "content": "Hi"}])
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error
        where = "on Amazon Bedrock" if self.method == "bedrock" else "API"
        return f"Connected to the Claude {where}. Model {message.model} answered."

    def structured(self, system: str, parts: list[Part], schema: dict, *, schema_name: str, max_tokens: int) -> Structured:
        request = dict(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": [_block(part) for part in parts]}],
        )
        try:
            if self.supports_server_fallback:
                # A declined request is retried on Anthropic's recommended fallback model.
                response = self.client().beta.messages.create(**request, betas=[FALLBACK_BETA], fallbacks="default")
            else:
                response = self.client().messages.create(**request)
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error

        if response.stop_reason == "refusal":
            raise AIError("refused", "Claude declined to process this request.")
        if response.stop_reason == "max_tokens":
            raise AIError("truncated", "The answer was too long and was cut off.")
        text = next((block.text for block in response.content if block.type == "text"), "")
        try:
            data = json.loads(text)
        except ValueError as error:
            raise AIError("invalid_output", "Claude returned an answer that could not be read. Please try again.") from error
        return Structured(data, response.model, {"input_tokens": response.usage.input_tokens, "output_tokens": response.usage.output_tokens})

    async def stream_turn(self, system: str, conversation: list[dict], tools: list[dict]) -> AsyncIterator[tuple[str, Any]]:
        try:
            # Leaving this `async with` (also when the browser disconnects) closes the HTTP stream,
            # which cancels generation on the provider side.
            async with self.client(async_client=True).messages.stream(
                model=self.model,
                max_tokens=MAX_TURN_TOKENS,
                system=system,
                tools=tools,
                messages=_messages(conversation),
                output_config={"effort": self.effort},
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_start" and getattr(event.content_block, "type", "") == "tool_use":
                        yield "tool_planned", event.content_block.name
                    elif event.type == "text":
                        yield "text", event.text
                final = await stream.get_final_message()
        except AIError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error

        calls = [ToolCall(b.id, b.name, b.input) for b in final.content if b.type == "tool_use"]
        stop = {"tool_use": "tool_use", "refusal": "refusal", "max_tokens": "max_tokens"}.get(final.stop_reason or "", "end")
        yield "final", Turn(
            stop=stop if (stop != "tool_use" or calls) else "end",
            raw=final.content,
            tool_calls=calls,
            model=final.model,
            usage={"input_tokens": final.usage.input_tokens, "output_tokens": final.usage.output_tokens},
        )


def _block(part: Part) -> dict:
    if isinstance(part, Pdf):
        return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(part.data).decode()}, "title": part.title}
    return {"type": "text", "text": part.text}


def _messages(conversation: list[dict]) -> list[dict]:
    messages: list[dict] = []
    for item in conversation:
        role = item["role"]
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": item["text"]})
        elif role == "turn":
            messages.append({"role": "assistant", "content": item["turn"].raw})
        elif role == "tool_results":
            messages.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": r.id, "content": r.content, "is_error": r.is_error} for r in item["results"]
            ]})
    return messages
