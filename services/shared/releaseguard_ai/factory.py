"""Turns the portal's `llm` credentials into a provider."""

from __future__ import annotations

from typing import Optional

from .base import Provider
from .errors import AIError

PROVIDER_LABELS = {
    "anthropic": "Claude",
    "gemini": "Gemini",
    "openai": "OpenAI",
    "openai_compatible": "OpenAI-compatible API",
}

NOT_CONNECTED = "No AI provider is connected. An admin must add Claude, Gemini, OpenAI or a compatible API on the Connections page."


def make_provider(credentials: Optional[dict], *, timeout: float = 300.0, effort: str = "low") -> Provider:
    """`credentials` is the `llm` object the portal sends: {"provider": ..., plus that provider's fields}."""
    if not credentials or not credentials.get("provider"):
        raise AIError("not_configured", NOT_CONNECTED)

    provider = credentials["provider"]
    # Imported lazily so a service only loads the SDK of the provider in use.
    if provider == "anthropic":
        from .anthropic_provider import AnthropicProvider

        return AnthropicProvider(credentials, timeout, effort)
    if provider == "gemini":
        from .gemini_provider import GeminiProvider

        return GeminiProvider(credentials, timeout)
    if provider == "openai":
        from .openai_provider import OpenAIProvider

        return OpenAIProvider(credentials, timeout)
    if provider == "openai_compatible":
        from .compatible_provider import CompatibleProvider

        return CompatibleProvider(credentials, timeout)
    raise AIError("not_configured", f"Unsupported AI provider: {provider}.")


def ping(credentials: Optional[dict]) -> str:
    return make_provider(credentials, timeout=30.0).ping()
