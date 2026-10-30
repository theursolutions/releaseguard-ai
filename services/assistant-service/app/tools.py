"""Business-data tools the assistant may call.

The tools are *defined* here (names, descriptions, JSON schemas) but *executed by the portal*, which
holds the data and enforces the asking user's permissions. Every call goes to the portal URL this
service is configured with (never a URL from the request, so no SSRF), with the service token plus
the portal-signed context of the user and product the conversation belongs to.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

MAX_RESULT_CHARS = 20_000  # keeps one tool result from flooding the model's context
TOOL_TIMEOUT_SECONDS = 30


def _object(properties: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": properties, "required": required or [], "additionalProperties": False}


TOOLS: list[dict] = [
    {
        "name": "get_portfolio_overview",
        "description": "Summary of the selected product (or all authorised products): PRD review counts and readiness, monitoring alarm counts, recent AI alarm diagnoses, and which data sources are connected. Use this first for broad questions like 'how are we doing?'.",
        "input_schema": _object({}),
    },
    {
        "name": "get_monitoring_status",
        "description": "Live CloudWatch alarm status for the selected product: each alarm's state, severity, resource and description, plus storage forecasts (days until disk full). May be demo data when AWS is not connected; the result says so.",
        "input_schema": _object({"state": {"type": "string", "enum": ["ALARM", "OK", "INSUFFICIENT_DATA", "all"], "description": "Filter by alarm state. Default all."}}),
    },
    {
        "name": "get_prd_reviews",
        "description": "Recent PRD (requirements) reviews with their readiness score (0-100, 70+ is ready for a sprint), status and author.",
        "input_schema": _object({
            "limit": {"type": "integer", "minimum": 1, "maximum": 20, "description": "How many reviews, newest first. Default 10."},
            "only_not_ready": {"type": "boolean", "description": "Only reviews scoring below the ready threshold."},
        }),
    },
    {
        "name": "get_prd_review_details",
        "description": "Full details of one PRD review: summary, score breakdown, blocking questions for the PM, dependencies, contradictions and the list of its user flows (id, name, actor).",
        "input_schema": _object({"review_id": {"type": "integer", "minimum": 1}}, ["review_id"]),
    },
    {
        "name": "get_prd_flow",
        "description": "One user flow from a PRD review, as actor swimlanes: lanes (actors), steps (start, action, decision, system, end), connections with decision conditions, and Given/When/Then acceptance criteria. Always the latest corrected version. The portal draws the returned flow for the person, so summarise it briefly. Without a flow (or when several match) it returns the review's flows to choose from.",
        "input_schema": _object({
            "review_id": {"type": "integer", "minimum": 1},
            "flow": {"type": "string", "maxLength": 120, "description": "Flow id (e.g. FLOW-AGENT-01) or part of its name."},
        }, ["review_id"]),
    },
    {
        "name": "get_alarm_diagnoses",
        "description": "Recent AI diagnoses of monitoring alarms: probable cause, impact and next steps.",
        "input_schema": _object({"limit": {"type": "integer", "minimum": 1, "maximum": 10}}),
    },
    {
        "name": "get_team_activity",
        "description": "Per-person activity inside ReleaseGuard over a period: PRD reviews submitted, their average readiness score, and alarm diagnoses requested. This is platform activity only, not HR performance; Jira delivery KPIs are reported separately if connected.",
        "input_schema": _object({"days": {"type": "integer", "minimum": 1, "maximum": 90, "description": "Look-back window in days. Default 30."}}),
    },
    {
        "name": "get_platform_status",
        "description": "Health of the ReleaseGuard platform itself: each internal service (PRD, monitoring, assistant, performance) online or offline with its version, the AI provider in use, and (admins only) which connections are configured.",
        "input_schema": _object({}),
    },
    {
        "name": "get_toolkit_inventory",
        "description": "The Claude Code developer toolkit (Module A) that ReleaseGuard installs into projects: its rules, skills (slash commands), agents, hooks and documentation.",
        "input_schema": _object({}),
    },
    {
        "name": "get_sales_performance",
        "description": "Real-estate sales performance from the CRM, scoped to what the asking person may see (executives: all agencies; agency owners/admins: their agency; agents: themselves). Returns won and lost revenue, deals, commissions paid and awaiting, leads, won/lost leads, conversion and win rate, active listings, enquiries, top agents, agencies, lead sources and lost reasons. Use it for questions about agents, agencies, revenue, earnings, deals or leads. May be demo data; the result says so.",
        "input_schema": _object({
            "period": {"type": "string", "enum": ["7d", "30d", "90d", "12m", "all"], "description": "Time window. Default 30d."},
            "agent_name": {"type": "string", "maxLength": 80, "description": "Focus on one agent by (part of) their name."},
        }),
    },
]

TOOL_NAMES = {tool["name"] for tool in TOOLS}

_TYPES = {"integer": int, "boolean": bool, "string": str}


def validate_input(name: str, data: Any) -> tuple[bool, str]:
    """Checks a tool call against its schema before anything is executed."""
    tool = next((t for t in TOOLS if t["name"] == name), None)
    if tool is None:
        return False, f"Unknown tool {name}."
    if not isinstance(data, dict):
        return False, "Tool input must be an object."
    schema = tool["input_schema"]
    for key in schema["required"]:
        if key not in data:
            return False, f"Missing required field {key}."
    for key, value in data.items():
        spec = schema["properties"].get(key)
        if spec is None:
            return False, f"Unexpected field {key}."
        expected = _TYPES[spec["type"]]
        if not isinstance(value, expected) or (expected is int and isinstance(value, bool)):
            return False, f"Field {key} must be a {spec['type']}."
        if "enum" in spec and value not in spec["enum"]:
            return False, f"Field {key} must be one of {spec['enum']}."
        if "minimum" in spec and value < spec["minimum"] or "maximum" in spec and value > spec["maximum"]:
            return False, f"Field {key} is out of range."
        if "maxLength" in spec and len(value) > spec["maxLength"]:
            return False, f"Field {key} is too long."
    return True, ""


class PortalToolExecutor:
    """Runs a validated tool call through the portal, as the user the conversation belongs to."""

    def __init__(self, context_token: str, client: httpx.AsyncClient | None = None):
        self.base_url = os.environ.get("PORTAL_INTERNAL_URL", "").rstrip("/")
        self.service_token = os.environ.get("SERVICE_TOKEN", "")
        self.context_token = context_token
        self.client = client

    async def __call__(self, name: str, data: dict) -> dict:
        ok, problem = validate_input(name, data)
        if not ok:
            return {"ok": False, "error": problem}
        if not self.base_url:
            return {"ok": False, "error": "The assistant service is not configured with the portal address (PORTAL_INTERNAL_URL)."}

        client = self.client or httpx.AsyncClient(timeout=TOOL_TIMEOUT_SECONDS)
        try:
            response = await client.post(
                f"{self.base_url}/internal/assistant/tools/{name}",
                json={"input": data},
                headers={"Authorization": f"Bearer {self.service_token}", "X-Assistant-Context": self.context_token, "Accept": "application/json"},
            )
        except httpx.HTTPError as error:
            logger.warning("Tool %s could not reach the portal: %s", name, type(error).__name__)
            return {"ok": False, "error": "The portal could not be reached to fetch this data."}
        finally:
            if self.client is None:
                await client.aclose()

        if response.status_code in (401, 403):
            return {"ok": False, "error": "Not authorised to read this data."}
        if response.status_code >= 400:
            return {"ok": False, "error": f"The portal could not provide this data (HTTP {response.status_code})."}
        try:
            payload = response.json()
        except ValueError:
            return {"ok": False, "error": "The portal returned unreadable data."}
        return {"ok": True, "data": payload}


def result_for_model(result: dict) -> str:
    """Serialises a tool result for Claude, capped in size."""
    text = json.dumps(result.get("data") if result.get("ok") else {"error": result.get("error")}, default=str)
    return text if len(text) <= MAX_RESULT_CHARS else text[:MAX_RESULT_CHARS] + '..."(truncated)"'
