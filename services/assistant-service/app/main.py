"""Assistant service API. Stateless: the portal stores conversations and sends credentials per call."""

from __future__ import annotations

import json
import logging
import os
from typing import AsyncIterator, Literal, Optional

from fastapi import Depends, FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from releaseguard_ai import AIError, make_provider
from releaseguard_ai.credentials import LLMCredentials
from releaseguard_ai.errors import AUTH_CODES, translate

from . import __version__, agent
from .security import require_service_token
from .tools import PortalToolExecutor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ReleaseGuard assistant service", version=__version__)


class Credentials(BaseModel):
    llm: Optional[LLMCredentials] = None  # the AI provider in use


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20_000)


class PrdReviewRef(BaseModel):
    id: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=255)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4_000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=40)
    user_name: str = Field(default="there", max_length=100)
    product: Optional[str] = Field(default=None, max_length=100)
    prd_review: Optional[PrdReviewRef] = None  # the PRD the person selected, already checked by the portal
    context_token: str = Field(min_length=10, max_length=2_000)
    credentials: Credentials = Credentials()


class StatusRequest(BaseModel):
    credentials: Credentials = Credentials()


def error_code(error: AIError) -> str:
    """The portal and browser only distinguish these codes."""
    if error.code in AUTH_CODES:
        return "auth_required"
    return error.code if error.code in ("rate_limited", "timeout") else "provider_error"


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "assistant-service", "version": __version__}


@app.get("/manifest")
def manifest() -> dict:
    return {
        "name": "assistant-service",
        "title": "Executive Assistant",
        "version": __version__,
        "description": "Voice-first executive assistant: streams answers from the connected AI provider and looks up ReleaseGuard business data through the portal.",
        "capabilities": ["assistant.chat.stream", "assistant.status", "assistant.tools"],
        "requires": ["ai"],
        "optional": [],
        "portal_callback_configured": bool(os.environ.get("PORTAL_INTERNAL_URL")),
    }


@app.post("/v1/status", dependencies=[Depends(require_service_token)])
def status(request: StatusRequest) -> dict:
    """Honest connection state: connected, auth_required or error. Never guesses."""
    credentials = request.credentials.llm.model_dump() if request.credentials.llm else None
    try:
        provider = make_provider(credentials, timeout=30.0)
        message = provider.ping()
    except AIError as error:
        return {"state": "auth_required" if error.code in AUTH_CODES else "error", "message": error.message}
    return {"state": "connected", "message": message, "provider": provider.name, "provider_label": provider.label, "model": provider.model}


@app.post("/v1/chat", dependencies=[Depends(require_service_token)])
async def chat(request: ChatRequest) -> StreamingResponse:
    credentials = request.credentials.llm.model_dump() if request.credentials.llm else None

    async def events() -> AsyncIterator[str]:
        label = "the AI provider"
        try:
            provider = make_provider(credentials, timeout=120.0, effort=os.environ.get("ASSISTANT_EFFORT", "low"))
            label = provider.label
            async for item in agent.run(
                provider,
                [message.model_dump() for message in request.history],
                request.message,
                PortalToolExecutor(request.context_token),
                agent.system_prompt(request.user_name, request.product, request.prd_review.model_dump() if request.prd_review else None),
            ):
                yield sse(item["event"], item["data"])
        except Exception as error:  # noqa: BLE001 - every failure reaches the user as a clear message
            failure = translate(error, label)
            yield sse("error", {"code": error_code(failure), "message": failure.message})

    # A client disconnect cancels this generator, which closes the provider stream.
    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
