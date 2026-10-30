"""Provider-neutral request and conversation types.

A conversation is a list of plain dicts, converted by each provider to its own message format:
  {"role": "user", "text": str}                      earlier user message
  {"role": "assistant", "text": str}                 earlier assistant answer (plain text)
  {"role": "turn", "turn": Turn}                     a model turn from this request, kept in the
                                                     provider's own format (thought signatures etc.)
  {"role": "tool_results", "results": [ToolResult]}  results of that turn's tool calls

Tools are declared once, in Anthropic's shape {"name", "description", "input_schema"}.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Literal, Union


@dataclass(frozen=True)
class Text:
    text: str


@dataclass(frozen=True)
class Pdf:
    data: bytes
    title: str = "document"


Part = Union[Text, Pdf]


@dataclass
class ToolCall:
    id: str
    name: str
    input: Any


@dataclass
class ToolResult:
    id: str
    name: str
    content: str
    is_error: bool = False


@dataclass
class Turn:
    stop: Literal["end", "tool_use", "max_tokens", "refusal"]
    raw: Any  # the provider's own representation, sent back unchanged on the next request
    tool_calls: list[ToolCall] = field(default_factory=list)
    model: str | None = None
    usage: dict = field(default_factory=dict)


@dataclass
class Structured:
    data: dict
    model: str
    usage: dict


def parse_json_object(text: str) -> dict:
    """Parses a JSON object answer; tolerates a markdown code fence some models add."""
    cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text or "")
    value = json.loads(cleaned)
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object")
    return value


def without_additional_properties(schema: Any) -> Any:
    """Copy of a JSON schema without `additionalProperties`, for providers that do not accept it."""
    if isinstance(schema, dict):
        return {k: without_additional_properties(v) for k, v in schema.items() if k != "additionalProperties"}
    if isinstance(schema, list):
        return [without_additional_properties(v) for v in schema]
    return schema
