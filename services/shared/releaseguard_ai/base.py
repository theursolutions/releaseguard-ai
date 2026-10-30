"""The interface every provider implements."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

from .types import Part, Structured

MAX_TURN_TOKENS = 8000


class Provider(ABC):
    name: str  # provider id: anthropic | gemini | openai | openai_compatible
    label: str  # shown to users, e.g. "Gemini"
    model: str

    @abstractmethod
    def ping(self) -> str:
        """Checks the credentials with the cheapest call the provider supports. Returns a message."""

    @abstractmethod
    def structured(self, system: str, parts: list[Part], schema: dict, *, schema_name: str, max_tokens: int) -> Structured:
        """One request whose answer must match `schema`. Raises AIError."""

    @abstractmethod
    def stream_turn(self, system: str, conversation: list[dict], tools: list[dict]) -> AsyncIterator[tuple[str, Any]]:
        """Streams one model turn: yields ("tool_planned", name), ("text", delta), then ("final", Turn).
        Closing the iterator (for example when the user presses Stop) cancels the provider stream."""
