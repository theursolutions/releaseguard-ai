"""OpenAI through the official SDK's Responses API (current OpenAI models support tools only there).

Requests are stateless (store=False): nothing is kept on OpenAI's side between turns. Reasoning items
come back encrypted and are sent back unchanged so the model keeps its reasoning across tool calls.
"""

from __future__ import annotations

import base64
import json
from typing import Any, AsyncIterator

import openai

from .base import MAX_TURN_TOKENS, Provider
from .errors import AIError, translate
from .types import Part, Pdf, Structured, ToolCall, Turn, parse_json_object

DEFAULT_MODEL = "gpt-6.1-sol"


class OpenAIProvider(Provider):
    name = "openai"
    label = "OpenAI"

    def __init__(self, credentials: dict, timeout: float = 300.0):
        if not credentials.get("api_key"):
            raise AIError("not_configured", "No OpenAI API key is saved. An admin must add one on the Connections page.")
        self.model = (credentials.get("model") or "").strip() or DEFAULT_MODEL
        self.api_key = credentials["api_key"]
        self.timeout = timeout

    def _client(self, async_client: bool = False):
        cls = openai.AsyncOpenAI if async_client else openai.OpenAI
        return cls(api_key=self.api_key, timeout=self.timeout, max_retries=1)

    def ping(self) -> str:
        # A tiny real request (16 is the minimum output size), so a key without quota is not shown as working.
        try:
            response = self._client().responses.create(model=self.model, input="Hi", max_output_tokens=16, store=False)
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error
        return f"Connected to OpenAI. Model {response.model} answered."

    def structured(self, system: str, parts: list[Part], schema: dict, *, schema_name: str, max_tokens: int) -> Structured:
        try:
            response = self._client().responses.create(
                model=self.model,
                instructions=system,
                input=[{"role": "user", "content": [_input_part(p) for p in parts]}],
                text={"format": {"type": "json_schema", "name": schema_name, "schema": schema, "strict": True}},
                max_output_tokens=max_tokens,
                store=False,
            )
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error

        stop = _stop(response, has_calls=False)
        if stop == "refusal":
            raise AIError("refused", "OpenAI declined to process this request.")
        if stop == "max_tokens":
            raise AIError("truncated", "The answer was too long and was cut off.")
        try:
            data = parse_json_object(response.output_text)
        except ValueError as error:
            raise AIError("invalid_output", "OpenAI returned an answer that could not be read. Please try again.") from error
        return Structured(data, response.model, _usage(response))

    async def stream_turn(self, system: str, conversation: list[dict], tools: list[dict]) -> AsyncIterator[tuple[str, Any]]:
        final = None
        stream = None
        try:
            stream = await self._client(async_client=True).responses.create(
                model=self.model,
                instructions=system,
                input=_input(conversation),
                tools=[{"type": "function", "name": t["name"], "description": t["description"], "parameters": t["input_schema"], "strict": False} for t in tools],
                max_output_tokens=MAX_TURN_TOKENS,
                store=False,
                include=["reasoning.encrypted_content"],
                stream=True,
            )
            async for event in stream:
                if event.type == "response.output_item.added" and getattr(event.item, "type", "") == "function_call":
                    yield "tool_planned", event.item.name
                elif event.type == "response.output_text.delta":
                    yield "text", event.delta
                elif event.type in ("response.completed", "response.incomplete"):
                    final = event.response
                elif event.type in ("response.failed", "error"):
                    raise AIError("unavailable", "OpenAI could not complete this request. Please try again.")
        except AIError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error
        finally:
            if stream is not None and hasattr(stream, "close"):
                await stream.close()

        if final is None:
            raise AIError("unavailable", "OpenAI ended the answer unexpectedly. Please try again.")

        calls = [ToolCall(item.call_id, item.name, _arguments(item.arguments)) for item in final.output if item.type == "function_call"]
        yield "final", Turn(stop=_stop(final, has_calls=bool(calls)), raw=_replay(final.output), tool_calls=calls, model=final.model, usage=_usage(final))


def _input_part(part: Part) -> dict:
    if isinstance(part, Pdf):
        data = base64.b64encode(part.data).decode()
        return {"type": "input_file", "filename": f"{part.title or 'document'}.pdf", "file_data": f"data:application/pdf;base64,{data}"}
    return {"type": "input_text", "text": part.text}


def _input(conversation: list[dict]) -> list[dict]:
    items: list[dict] = []
    for entry in conversation:
        role = entry["role"]
        if role in ("user", "assistant"):
            items.append({"role": role, "content": entry["text"]})
        elif role == "turn":
            items.extend(entry["turn"].raw)
        elif role == "tool_results":
            items.extend({"type": "function_call_output", "call_id": r.id, "output": r.content} for r in entry["results"])
    return items


def _replay(output: list) -> list[dict]:
    """The turn's output as input items for the next request: reasoning (encrypted), text and tool calls."""
    items: list[dict] = []
    for item in output:
        if item.type == "reasoning":
            items.append(item.model_dump(exclude_none=True))
        elif item.type == "function_call":
            items.append({"type": "function_call", "call_id": item.call_id, "name": item.name, "arguments": item.arguments})
        elif item.type == "message":
            text = "".join(getattr(c, "text", "") for c in item.content if getattr(c, "type", "") == "output_text")
            if text:
                items.append({"role": "assistant", "content": text})
    return items


def _arguments(raw: str | None) -> Any:
    try:
        return json.loads(raw or "{}")
    except ValueError:
        return {"_invalid_arguments": raw}  # rejected by tool validation, which tells the model


def _stop(response, *, has_calls: bool) -> str:
    if has_calls:
        return "tool_use"
    for item in response.output:
        if item.type == "message" and any(getattr(c, "type", "") == "refusal" for c in item.content):
            return "refusal"
    if response.status == "incomplete":
        reason = getattr(response.incomplete_details, "reason", None)
        return "refusal" if reason == "content_filter" else "max_tokens"
    return "end"


def _usage(response) -> dict:
    usage = response.usage
    return {"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens} if usage else {}
