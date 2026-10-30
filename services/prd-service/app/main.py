"""PRD service API. Stateless: the portal stores history and sends credentials with each call."""

from __future__ import annotations

import logging
from typing import Literal, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from releaseguard_ai import AIError
from releaseguard_ai import ping as ping_ai
from releaseguard_ai.credentials import LLMCredentials

from . import __version__, analyzer, sources
from .security import require_service_token

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="ReleaseGuard PRD service", version=__version__)


class AtlassianCredentials(BaseModel):
    site_url: str
    email: str
    api_token: str


class Credentials(BaseModel):
    llm: Optional[LLMCredentials] = None  # the AI provider in use
    atlassian: Optional[AtlassianCredentials] = None


class Document(BaseModel):
    kind: Literal["pdf", "docx", "text", "confluence"]
    data_base64: Optional[str] = None
    text: Optional[str] = None
    url: Optional[str] = None


class AnalyseRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    document: Document
    credentials: Credentials


class ReviseFlowRequest(BaseModel):
    prd_title: str = Field(min_length=1, max_length=255)
    flow: dict
    instruction: str = Field(min_length=3, max_length=1000)
    credentials: Credentials


class ConnectionTestRequest(BaseModel):
    # "ai" tests the provider in use; the others test that provider's saved connection.
    connection: Literal["ai", "anthropic", "gemini", "openai", "openai_compatible", "atlassian"]
    credentials: Credentials


def _llm(credentials: Credentials) -> Optional[dict]:
    return credentials.llm.model_dump() if credentials.llm else None


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "prd-service", "version": __version__}


@app.get("/manifest")
def manifest() -> dict:
    return {
        "name": "prd-service",
        "title": "PRD Checker",
        "version": __version__,
        "description": "Reviews PRDs: actors, flows, Given/When/Then criteria, questions for the PM, readiness score and flow diagrams. Revises one flow from a spoken or typed correction.",
        "capabilities": ["prd.analyse", "prd.flows.revise", "connections.test.ai", "connections.test.atlassian"],
        "requires": ["ai"],
        "optional": ["atlassian"],
        "accepts": ["pdf", "docx", "text", "confluence"],
    }


@app.post("/v1/analyses", dependencies=[Depends(require_service_token)])
def analyse(request: AnalyseRequest) -> dict:
    if not request.credentials.llm:
        raise HTTPException(422, "No AI provider is connected.")

    atlassian = request.credentials.atlassian.model_dump() if request.credentials.atlassian else None
    try:
        content, page_title = sources.content_blocks(request.document.model_dump(), request.title, atlassian)
        outcome = analyzer.analyse(content, request.title, _llm(request.credentials))
    except (sources.SourceError, analyzer.AnalysisError) as error:
        raise HTTPException(422, str(error)) from error
    except httpx.HTTPError as error:
        raise HTTPException(502, "Could not reach Confluence.") from error

    return {**outcome, "source_title": page_title}


@app.post("/v1/flows/revise", dependencies=[Depends(require_service_token)])
def revise_flow(request: ReviseFlowRequest) -> dict:
    if not request.credentials.llm:
        raise HTTPException(422, "No AI provider is connected.")
    try:
        return analyzer.revise(request.flow, request.instruction, request.prd_title, _llm(request.credentials))
    except analyzer.InvalidRevision as error:
        raise HTTPException(502, str(error)) from error
    except analyzer.AnalysisError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/v1/connections/test", dependencies=[Depends(require_service_token)])
def test_connection(request: ConnectionTestRequest) -> dict:
    try:
        if request.connection != "atlassian":
            message = ping_ai(_llm(request.credentials))
        else:
            atlassian = request.credentials.atlassian
            if not atlassian:
                return {"ok": False, "message": "Enter the site, email and API token first."}
            message = _test_atlassian(atlassian)
    except sources.SourceError as error:
        return {"ok": False, "message": str(error)}
    except AIError as error:
        return {"ok": False, "message": error.message}
    return {"ok": True, "message": message}


def _test_atlassian(atlassian: AtlassianCredentials) -> str:
    site = atlassian.site_url.rstrip("/")
    if not site.startswith("https://") or not site.endswith(".atlassian.net"):
        raise sources.SourceError("The site URL must look like https://your-company.atlassian.net")
    try:
        response = httpx.get(f"{site}/rest/api/3/myself", auth=(atlassian.email, atlassian.api_token), headers={"Accept": "application/json"}, timeout=15)
    except httpx.HTTPError as error:
        raise sources.SourceError("Could not reach the Atlassian site.") from error
    if response.status_code in (401, 403):
        raise sources.SourceError("Atlassian rejected the email or API token.")
    if response.status_code >= 400:
        raise sources.SourceError(f"Atlassian returned HTTP {response.status_code}.")
    return f"Connected as {response.json().get('displayName', atlassian.email)}."
