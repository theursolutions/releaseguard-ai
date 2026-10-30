"""Builds and sends the Slack alert message (Block Kit, via an incoming webhook)."""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Optional
from urllib.parse import quote

from .alarm import Alarm

SECTION_LIMIT = 2900  # Slack rejects section text over 3000 characters.
HEADER_LIMIT = 150

STATE_TITLES = {
    "OK": ":white_check_mark: RESOLVED",
    "INSUFFICIENT_DATA": ":grey_question: NO DATA",
}
SEVERITY_TITLES = {"critical": ":red_circle: CRITICAL", "warning": ":large_orange_circle: WARNING"}


def escape(text: str) -> str:
    """Slack treats &, < and > as control characters in mrkdwn."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _section(text: str) -> dict:
    return {"type": "section", "text": {"type": "mrkdwn", "text": _clip(text, SECTION_LIMIT)}}


def alarm_console_url(alarm: Alarm) -> str:
    region = alarm.region or "us-east-1"
    return f"https://{region}.console.aws.amazon.com/cloudwatch/home?region={region}#alarmsV2:alarm/{quote(alarm.name, safe='')}"


def title_for(alarm: Alarm) -> str:
    prefix = SEVERITY_TITLES[alarm.severity] if alarm.state == "ALARM" else STATE_TITLES.get(alarm.state, alarm.state)
    return _clip(f"{prefix}: {alarm.name}", HEADER_LIMIT)


def _diagnosis_blocks(diagnosis: dict) -> list:
    blocks = [
        {"type": "divider"},
        _section(f"*:robot_face: AI diagnosis* (confidence: {escape(diagnosis.get('confidence', 'unknown'))})\n{escape(diagnosis.get('summary', ''))}"),
        _section(f"*Probable cause:* {escape(diagnosis.get('probable_cause', ''))}\n*Impact:* {escape(diagnosis.get('impact', ''))}"),
    ]
    if diagnosis.get("evidence"):
        blocks.append(_section("*Evidence:*\n" + "\n".join(f"• {escape(item)}" for item in diagnosis["evidence"])))
    if diagnosis.get("next_steps"):
        blocks.append(_section("*Next steps:*\n" + "\n".join(f"{i}. {escape(step)}" for i, step in enumerate(diagnosis["next_steps"], 1))))
    if diagnosis.get("is_likely_false_alarm"):
        blocks.append(_section(":information_source: This looks like a *likely false alarm*. Check the evidence before acting."))
    return blocks


def build_message(alarm: Alarm, diagnosis: Optional[dict], runbook_key: Optional[str], diagnosis_error: Optional[str] = None) -> dict:
    environment = os.environ.get("ENVIRONMENT", "")
    metric = alarm.primary_metric
    title = title_for(alarm)

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": title}},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Environment:*\n{escape(environment or 'n/a')}"},
                {"type": "mrkdwn", "text": f"*Resource:*\n{escape(alarm.resource)}"},
                {"type": "mrkdwn", "text": f"*Metric:*\n{escape(f'{metric.namespace} {metric.name}' if metric else 'n/a')}"},
                {"type": "mrkdwn", "text": f"*Time:*\n{escape(alarm.time)}"},
            ],
        },
        _section(f"*Reason:* {escape(alarm.reason)}"),
    ]

    if diagnosis:
        blocks.extend(_diagnosis_blocks(diagnosis))
    elif diagnosis_error:
        blocks.append(_section(f":warning: {escape(diagnosis_error)}"))

    buttons = [{"type": "button", "text": {"type": "plain_text", "text": "Open alarm"}, "url": alarm_console_url(alarm)}]
    runbook_base = os.environ.get("RUNBOOK_BASE_URL", "").rstrip("/")
    if runbook_key and runbook_base:
        buttons.append({"type": "button", "text": {"type": "plain_text", "text": "Runbook"}, "url": f"{runbook_base}/{runbook_key}.md"})
    blocks.append({"type": "actions", "elements": buttons})

    if diagnosis:
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": "AI-generated from metrics and logs. Verify before acting."}]})

    return {"text": title, "blocks": blocks}


def post(webhook_url: str, message: dict) -> None:
    request = urllib.request.Request(
        webhook_url, data=json.dumps(message).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310 - URL comes from Secrets Manager
        if response.status >= 300:
            raise RuntimeError(f"Slack webhook returned HTTP {response.status}")
