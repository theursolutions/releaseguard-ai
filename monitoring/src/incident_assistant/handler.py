"""Lambda entry point. Subscribed to the ReleaseGuard SNS alert topics."""

from __future__ import annotations

import logging
import os

from .alarm import Alarm, parse_sns_record
from .aws_secrets import get_secret
from .context import collect_context
from .diagnosis import DEFAULT_MODEL, diagnose
from .runbooks import load_runbook, runbook_key_for
from .slack import build_message, post

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handle_alarm(alarm: Alarm) -> dict:
    runbook_key = runbook_key_for(alarm)
    diagnosis, diagnosis_error = None, None

    # Only new problems get a diagnosis. Recoveries and "no data" are posted as they are.
    if alarm.state == "ALARM":
        try:
            context = collect_context(alarm)
            diagnosis = diagnose(
                alarm,
                context,
                load_runbook(runbook_key),
                api_key=get_secret(os.environ["ANTHROPIC_SECRET_ARN"]),
                model=os.environ.get("CLAUDE_MODEL") or DEFAULT_MODEL,
            )
        except Exception:  # noqa: BLE001 - the alert must still reach Slack without a diagnosis
            logger.exception("Diagnosis failed for alarm %s", alarm.name)
            diagnosis_error = "AI diagnosis unavailable for this alert. See the incident-assistant Lambda logs."

    message = build_message(alarm, diagnosis, runbook_key, diagnosis_error)
    post(get_secret(os.environ["SLACK_SECRET_ARN"]), message)
    logger.info("Posted %s for %s (diagnosis: %s)", alarm.state, alarm.name, "yes" if diagnosis else "no")
    return message


def lambda_handler(event: dict, _context) -> dict:
    handled = 0
    for record in event.get("Records", []):
        alarm = parse_sns_record(record)
        if alarm is None:
            logger.warning("Ignoring SNS message that is not a CloudWatch alarm")
            continue
        handle_alarm(alarm)
        handled += 1
    return {"handled": handled}
