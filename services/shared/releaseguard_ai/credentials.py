"""The `llm` credentials object the portal sends to every service (only the active provider's fields)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class LLMCredentials(BaseModel):
    provider: Literal["anthropic", "gemini", "openai", "openai_compatible"]
    # Claude only. Subscription sign-ins are not accepted (see the package docstring).
    auth_method: Optional[Literal["api_key", "server_identity", "bedrock"]] = None
    api_key: Optional[str] = Field(default=None, max_length=2000)
    model: Optional[str] = Field(default=None, max_length=100)
    bedrock_region: Optional[str] = None
    bedrock_access_key_id: Optional[str] = None
    bedrock_secret_access_key: Optional[str] = None
    # OpenAI-compatible only.
    base_url: Optional[str] = Field(default=None, max_length=255)
    name: Optional[str] = Field(default=None, max_length=40)
