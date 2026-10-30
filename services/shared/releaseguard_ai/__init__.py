"""ReleaseGuard AI gateway: one provider-neutral interface over the AI providers an admin can connect.

Every service (PRD checker, monitoring diagnosis, assistant) talks to AI only through this package,
so adding or switching a provider never touches the services. Supported providers:

  anthropic          Claude: Console API key, server identity (Workload Identity Federation), Amazon Bedrock
  gemini             Google Gemini API key (Google AI Studio / Google Cloud)
  openai             OpenAI API key (Responses API)
  openai_compatible  Any Chat Completions-compatible API: Groq, Mistral, DeepSeek, OpenRouter, xAI,
                     Together, or a local Ollama / LM Studio server

Claude subscription logins (claude.ai, `claude setup-token`) are deliberately NOT supported: Anthropic's
terms reserve them for Claude Code and Anthropic's own apps.
"""

from .errors import AIError
from .factory import PROVIDER_LABELS, make_provider, ping
from .types import Pdf, Structured, Text, ToolCall, ToolResult, Turn

__all__ = ["AIError", "PROVIDER_LABELS", "make_provider", "ping", "Pdf", "Structured", "Text", "ToolCall", "ToolResult", "Turn"]
