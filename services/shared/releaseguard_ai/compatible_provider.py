"""Any OpenAI-compatible Chat Completions API, through the official OpenAI SDK with a custom base URL.

Covers Groq, Mistral, DeepSeek, OpenRouter, xAI, Together, and local servers such as Ollama or
LM Studio. Capabilities differ between them, so structured answers fall back step by step
(JSON schema -> JSON mode -> plain instructions) and the answer is always validated as JSON.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import openai

from .base import MAX_TURN_TOKENS, Provider
from .errors import AIError, translate
from .types import Part, Pdf, Structured, ToolCall, Turn, parse_json_object


class CompatibleProvider(Provider):
    name = "openai_compatible"

    def __init__(self, credentials: dict, timeout: float = 300.0):
        self.base_url = (credentials.get("base_url") or "").strip().rstrip("/")
        self.model = (credentials.get("model") or "").strip()
        self.label = (credentials.get("name") or "").strip() or "OpenAI-compatible API"
        if not self.base_url.startswith(("https://", "http://")):
            raise AIError("not_configured", "No base URL is saved for the OpenAI-compatible API. An admin must add one on the Connections page.")
        if not self.model:
            raise AIError("not_configured", "No model is saved for the OpenAI-compatible API. An admin must add one on the Connections page.")
        # Local servers (Ollama, LM Studio) need no key, but the SDK requires a value.
        self.api_key = credentials.get("api_key") or "not-needed"
        self.timeout = timeout

    def _client(self, async_client: bool = False):
        cls = openai.AsyncOpenAI if async_client else openai.OpenAI
        return cls(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout, max_retries=1)

    def ping(self) -> str:
        client = self._client()
        try:
            ids = [model.id for model in client.models.list()]
        except openai.NotFoundError:
            ids = None  # some servers have no model list: fall back to a tiny real request
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error

        if ids is not None:
            if self.model not in ids:
                raise AIError("model_not_found", f"{self.label} is reachable, but it does not offer the model {self.model}.")
            return f"Connected to {self.label}. Model {self.model} is available."
        try:
            client.chat.completions.create(model=self.model, max_tokens=5, messages=[{"role": "user", "content": "Reply with OK."}])
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error
        return f"Connected to {self.label} ({self.model})."

    def structured(self, system: str, parts: list[Part], schema: dict, *, schema_name: str, max_tokens: int) -> Structured:
        if any(isinstance(part, Pdf) for part in parts):
            raise AIError(
                "unsupported",
                f"{self.label} cannot read PDF files. Upload the document as Word, Markdown or text, or switch to Claude, Gemini or OpenAI.",
            )
        user = "\n\n".join(part.text for part in parts)
        schema_text = f"\n\nAnswer with one JSON object only, matching this JSON schema:\n{json.dumps(schema)}"
        attempts = [
            (system, {"type": "json_schema", "json_schema": {"name": schema_name, "schema": schema, "strict": True}}),
            (system + schema_text, {"type": "json_object"}),
            (system + schema_text, None),
        ]
        client = self._client()
        response = None
        for index, (instructions, response_format) in enumerate(attempts):
            request = dict(model=self.model, max_tokens=max_tokens, messages=[{"role": "system", "content": instructions}, {"role": "user", "content": user}])
            if response_format:
                request["response_format"] = response_format
            try:
                response = client.chat.completions.create(**request)
                break
            except openai.BadRequestError as error:
                if index == len(attempts) - 1:  # unsupported response format: try the next, simpler one
                    raise translate(error, self.label) from error
            except Exception as error:  # noqa: BLE001
                raise translate(error, self.label) from error

        choice = response.choices[0]
        if choice.finish_reason == "length":
            raise AIError("truncated", "The answer was too long and was cut off.")
        if choice.finish_reason == "content_filter" or (getattr(choice.message, "refusal", None) and not choice.message.content):
            raise AIError("refused", f"{self.label} declined to process this request.")
        try:
            data = parse_json_object(choice.message.content or "")
        except ValueError as error:
            raise AIError("invalid_output", f"{self.label} returned an answer that could not be read. Try again, or use a stronger model.") from error
        usage = response.usage
        return Structured(data, response.model or self.model, {"input_tokens": usage.prompt_tokens, "output_tokens": usage.completion_tokens} if usage else {})

    async def stream_turn(self, system: str, conversation: list[dict], tools: list[dict]) -> AsyncIterator[tuple[str, Any]]:
        text, calls, reason, model = "", {}, None, None
        stream = None
        try:
            stream = await self._client(async_client=True).chat.completions.create(
                model=self.model,
                max_tokens=MAX_TURN_TOKENS,
                messages=[{"role": "system", "content": system}, *_messages(conversation)],
                tools=[{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in tools],
                stream=True,
            )
            async for chunk in stream:
                model = chunk.model or model
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                reason = choice.finish_reason or reason
                delta = choice.delta
                if delta and delta.content:
                    text += delta.content
                    yield "text", delta.content
                for piece in (delta.tool_calls or []) if delta else []:
                    call = calls.setdefault(piece.index, {"id": None, "name": "", "arguments": ""})
                    call["id"] = piece.id or call["id"]
                    if piece.function and piece.function.name and not call["name"]:
                        call["name"] = piece.function.name
                        yield "tool_planned", call["name"]
                    if piece.function and piece.function.arguments:
                        call["arguments"] += piece.function.arguments
        except AIError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error
        finally:
            if stream is not None and hasattr(stream, "close"):
                await stream.close()

        ordered = [calls[i] for i in sorted(calls)]
        for i, call in enumerate(ordered):
            call["id"] = call["id"] or f"call_{i}"
        raw = {"role": "assistant", "content": text or None}
        if ordered:
            raw["tool_calls"] = [{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}} for c in ordered]

        if ordered:
            stop = "tool_use"
        elif reason == "length":
            stop = "max_tokens"
        elif reason == "content_filter":
            stop = "refusal"
        else:
            stop = "end"
        yield "final", Turn(stop=stop, raw=raw, tool_calls=[ToolCall(c["id"], c["name"], _arguments(c["arguments"])) for c in ordered], model=model or self.model)


def _messages(conversation: list[dict]) -> list[dict]:
    messages: list[dict] = []
    for item in conversation:
        role = item["role"]
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": item["text"]})
        elif role == "turn":
            messages.append(item["turn"].raw)
        elif role == "tool_results":
            messages.extend({"role": "tool", "tool_call_id": r.id, "content": r.content} for r in item["results"])
    return messages


def _arguments(raw: str) -> Any:
    try:
        return json.loads(raw or "{}")
    except ValueError:
        return {"_invalid_arguments": raw}  # rejected by tool validation, which tells the model
