"""Google Gemini through the official google-genai SDK (generate_content API)."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

from google import genai
from google.genai import types

from .base import MAX_TURN_TOKENS, Provider
from .errors import AIError, translate
from .types import Part, Pdf, Structured, ToolCall, Turn, parse_json_object, without_additional_properties

DEFAULT_MODEL = "gemini-3.8-flash"
GENERATED_ID_PREFIX = "gemini-call-"  # Gemini may omit call ids; generated ones are never sent back

REFUSAL_REASONS = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"}


class GeminiProvider(Provider):
    name = "gemini"
    label = "Gemini"

    def __init__(self, credentials: dict, timeout: float = 300.0):
        if not credentials.get("api_key"):
            raise AIError("not_configured", "No Gemini API key is saved. An admin must add one on the Connections page.")
        self.model = (credentials.get("model") or "").strip() or DEFAULT_MODEL
        # The SDK takes the timeout in milliseconds.
        self.client = genai.Client(api_key=credentials["api_key"], http_options=types.HttpOptions(timeout=int(timeout * 1000)))

    def ping(self) -> str:
        # A tiny real request, so a key without quota is not shown as working.
        try:
            response = self.client.models.generate_content(model=self.model, contents="Hi", config=types.GenerateContentConfig(max_output_tokens=8))
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error
        return f"Connected to Gemini. Model {response.model_version or self.model} answered."

    def structured(self, system: str, parts: list[Part], schema: dict, *, schema_name: str, max_tokens: int) -> Structured:
        config = types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            response_mime_type="application/json",
            response_json_schema=without_additional_properties(schema),
        )
        try:
            response = self.client.models.generate_content(
                model=self.model, contents=[types.Content(role="user", parts=[_part(p) for p in parts])], config=config
            )
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error

        _raise_if_blocked(response)
        candidate = response.candidates[0]
        if _reason(candidate) == "MAX_TOKENS":
            raise AIError("truncated", "The answer was too long and was cut off.")
        try:
            data = parse_json_object(response.text or "")
        except ValueError as error:
            raise AIError("invalid_output", "Gemini returned an answer that could not be read. Please try again.") from error
        return Structured(data, response.model_version or self.model, _usage(response.usage_metadata))

    async def stream_turn(self, system: str, conversation: list[dict], tools: list[dict]) -> AsyncIterator[tuple[str, Any]]:
        config = types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=MAX_TURN_TOKENS,
            tools=[types.Tool(function_declarations=[
                types.FunctionDeclaration(name=t["name"], description=t["description"], parameters_json_schema=t["input_schema"]) for t in tools
            ])],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        # Every part is kept exactly as received (never merged), because thought signatures are attached
        # to parts and must be sent back unchanged on the next request.
        parts: list[types.Part] = []
        reason, usage, model, blocked = None, None, None, False
        stream = None
        try:
            stream = await self.client.aio.models.generate_content_stream(model=self.model, contents=_contents(conversation), config=config)
            async for chunk in stream:
                model = chunk.model_version or model
                usage = chunk.usage_metadata or usage
                if chunk.prompt_feedback and chunk.prompt_feedback.block_reason:
                    blocked = True
                for candidate in chunk.candidates or []:
                    reason = _reason(candidate) or reason
                    for part in (candidate.content.parts if candidate.content and candidate.content.parts else []):
                        parts.append(part)
                        if part.function_call:
                            yield "tool_planned", part.function_call.name
                        elif part.text and not part.thought:
                            yield "text", part.text
        except AIError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate(error, self.label) from error
        finally:
            if stream is not None and hasattr(stream, "aclose"):
                await stream.aclose()

        calls = [
            ToolCall(p.function_call.id or f"{GENERATED_ID_PREFIX}{i}", p.function_call.name, dict(p.function_call.args or {}))
            for i, p in enumerate(parts) if p.function_call
        ]
        if calls:
            stop = "tool_use"
        elif blocked or reason in REFUSAL_REASONS:
            stop = "refusal"
        elif reason == "MAX_TOKENS":
            stop = "max_tokens"
        else:
            stop = "end"
        yield "final", Turn(stop=stop, raw=types.Content(role="model", parts=parts), tool_calls=calls, model=model or self.model, usage=_usage(usage))


def _part(part: Part) -> types.Part:
    if isinstance(part, Pdf):
        return types.Part.from_bytes(data=part.data, mime_type="application/pdf")
    return types.Part.from_text(text=part.text)


def _contents(conversation: list[dict]) -> list[types.Content]:
    contents: list[types.Content] = []
    for item in conversation:
        role = item["role"]
        if role == "user":
            contents.append(types.Content(role="user", parts=[types.Part.from_text(text=item["text"])]))
        elif role == "assistant":
            contents.append(types.Content(role="model", parts=[types.Part.from_text(text=item["text"])]))
        elif role == "turn":
            contents.append(item["turn"].raw)
        elif role == "tool_results":
            contents.append(types.Content(role="user", parts=[
                types.Part(function_response=types.FunctionResponse(
                    id=None if r.id.startswith(GENERATED_ID_PREFIX) else r.id,
                    name=r.name,
                    response={"error": r.content} if r.is_error else {"output": _json_or_text(r.content)},
                ))
                for r in item["results"]
            ]))
    return contents


def _json_or_text(content: str) -> Any:
    try:
        return json.loads(content)
    except ValueError:
        return content


def _reason(candidate) -> str | None:
    reason = getattr(candidate, "finish_reason", None)
    return getattr(reason, "name", None) or (str(reason) if reason else None)


def _raise_if_blocked(response) -> None:
    if response.prompt_feedback and response.prompt_feedback.block_reason:
        raise AIError("refused", "Gemini declined to process this request.")
    if not response.candidates:
        raise AIError("refused", "Gemini returned no answer for this request.")
    if _reason(response.candidates[0]) in REFUSAL_REASONS:
        raise AIError("refused", "Gemini declined to process this request.")


def _usage(metadata) -> dict:
    if not metadata:
        return {}
    return {"input_tokens": metadata.prompt_token_count or 0, "output_tokens": metadata.candidates_token_count or 0}
