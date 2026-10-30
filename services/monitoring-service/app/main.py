"""Monitoring service API. Stateless: the portal stores history and sends credentials with each call."""

from __future__ import annotations

import json
import logging
import urllib.request
from datetime import datetime, timezone
from typing import Literal, Optional
from urllib.parse import urlparse

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from incident_assistant.context import collect_context
from incident_assistant.diagnosis import DIAGNOSIS_SCHEMA, SYSTEM_PROMPT, build_prompt
from incident_assistant.runbooks import load_runbook, runbook_key_for

from releaseguard_ai import AIError, Text, make_provider
from releaseguard_ai.credentials import LLMCredentials

from . import __version__, cloudwatch, demo
from .security import require_service_token

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ReleaseGuard monitoring service", version=__version__)


class AwsCredentials(BaseModel):
    region: str = Field(pattern=r"^[a-z]{2}(-[a-z]+)+-\d$")
    access_key_id: str = Field(min_length=16)
    secret_access_key: str = Field(min_length=16)
    alarm_prefix: Optional[str] = None
    log_group_prefix: Optional[str] = None


class SlackCredentials(BaseModel):
    webhook_url: str


class Credentials(BaseModel):
    aws: Optional[AwsCredentials] = None
    llm: Optional[LLMCredentials] = None  # the AI provider in use
    slack: Optional[SlackCredentials] = None


class OverviewRequest(BaseModel):
    credentials: Credentials = Credentials()


class DiagnoseRequest(BaseModel):
    alarm_name: str = Field(min_length=1, max_length=255)
    credentials: Credentials = Credentials()


class ConnectionTestRequest(BaseModel):
    connection: Literal["aws", "slack"]
    credentials: Credentials


def _aws_error(error: Exception) -> HTTPException:
    code = getattr(error, "response", {}).get("Error", {}).get("Code", type(error).__name__) if isinstance(error, ClientError) else type(error).__name__
    logger.warning("AWS call failed: %s", code)
    return HTTPException(502, f"AWS rejected the request ({code}). Check the AWS connection.")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "monitoring-service", "version": __version__}


@app.get("/manifest")
def manifest() -> dict:
    return {
        "name": "monitoring-service",
        "title": "Monitoring",
        "version": __version__,
        "description": "CloudWatch alarm status, storage forecasts and AI diagnosis of alarms. Shows demo data until AWS is connected.",
        "capabilities": ["alarms.list", "alarms.live_series", "forecasts.list", "alarms.diagnose", "connections.test.aws", "connections.test.slack"],
        "requires": [],
        "optional": ["aws", "ai", "slack"],
    }


@app.post("/v1/overview", dependencies=[Depends(require_service_token)])
def overview(request: OverviewRequest) -> dict:
    aws = request.credentials.aws
    now = datetime.now(timezone.utc)
    if not aws:
        alarms = demo.alarms_at(now)
        forecasts = [cloudwatch.forecast_entry(resource, days) for resource, days in demo.forecasts_at(now)]
        series = demo.series_at(now)
    else:
        try:
            session = cloudwatch.session_for(aws.model_dump())
            alarms = cloudwatch.list_alarms(session, aws.region, aws.alarm_prefix)
            forecasts = cloudwatch.list_forecasts(session, aws.region)
            series = cloudwatch.recent_series(session, aws.region, alarms)
        except (ClientError, BotoCoreError) as error:
            raise _aws_error(error) from error

    summaries = [{**cloudwatch.summarise(alarm), "series": series.get(alarm.name, [])} for alarm in alarms]
    counts = {state: sum(1 for a in summaries if a["state"] == state) for state in ("ALARM", "OK", "INSUFFICIENT_DATA")}
    counts["critical"] = sum(1 for a in summaries if a["state"] == "ALARM" and a["severity"] == "critical")
    return {"demo": aws is None, "alarms": summaries, "forecasts": forecasts, "counts": counts, "generated_at": now.isoformat()}


@app.post("/v1/alarms/diagnose", dependencies=[Depends(require_service_token)])
def diagnose_alarm(request: DiagnoseRequest) -> dict:
    aws, llm = request.credentials.aws, request.credentials.llm

    if aws is None:
        alarm = demo.find_alarm(request.alarm_name, datetime.now(timezone.utc))
        if alarm is None:
            raise HTTPException(404, "Alarm not found.")
        context = demo.CONTEXTS.get(alarm.name, demo.GENERIC_CONTEXT)
    else:
        try:
            session = cloudwatch.session_for(aws.model_dump())
            alarm = cloudwatch.get_alarm(session, aws.region, request.alarm_name)
        except (ClientError, BotoCoreError) as error:
            raise _aws_error(error) from error
        if alarm is None:
            raise HTTPException(404, "Alarm not found.")
        context = collect_context(alarm, session=session, log_group_prefix=aws.log_group_prefix or "")

    summary = cloudwatch.summarise(alarm)
    if llm is None:
        if aws is None:
            return {"demo": True, "canned": True, "alarm": summary, "diagnosis": demo.CANNED_DIAGNOSIS, "model": None}
        raise HTTPException(422, "Connect an AI provider on the Connections page to diagnose alarms.")

    try:
        provider = make_provider(llm.model_dump(), timeout=120.0)
        reply = provider.structured(
            SYSTEM_PROMPT,
            [Text(build_prompt(alarm, context, load_runbook(runbook_key_for(alarm))))],
            DIAGNOSIS_SCHEMA,
            schema_name="alarm_diagnosis",
            max_tokens=16000,
        )
    except AIError as error:
        raise HTTPException(422, error.message) from error

    return {"demo": aws is None, "canned": False, "alarm": summary, "diagnosis": reply.data, "model": reply.model}


@app.post("/v1/connections/test", dependencies=[Depends(require_service_token)])
def test_connection(request: ConnectionTestRequest) -> dict:
    if request.connection == "aws":
        aws = request.credentials.aws
        if not aws:
            return {"ok": False, "message": "Enter the region and access keys first."}
        try:
            return {"ok": True, "message": cloudwatch.connection_check(cloudwatch.session_for(aws.model_dump()), aws.region)}
        except (ClientError, BotoCoreError) as error:
            return {"ok": False, "message": _aws_error(error).detail}

    slack = request.credentials.slack
    if not slack:
        return {"ok": False, "message": "Enter the webhook URL first."}
    url = urlparse(slack.webhook_url)
    # Only Slack's webhook host is allowed, so this endpoint cannot be used to call other URLs.
    if url.scheme != "https" or url.hostname != "hooks.slack.com":
        return {"ok": False, "message": "The webhook URL must start with https://hooks.slack.com/"}
    payload = json.dumps({"text": ":white_check_mark: ReleaseGuard connection test. Alerts will arrive in this channel."}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(slack.webhook_url, data=payload, headers={"Content-Type": "application/json"}), timeout=10):  # noqa: S310
            pass
    except OSError:
        return {"ok": False, "message": "Slack rejected the webhook. Check the URL."}
    return {"ok": True, "message": "Test message sent to Slack."}
