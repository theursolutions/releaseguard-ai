"""Parses the CloudWatch alarm notification that SNS delivers to the Lambda."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional

# Topics whose name ends with one of these are treated as critical; everything else is a warning.
CRITICAL_TOPIC_SUFFIXES = ("-critical", "-uptime")

RESOURCE_DIMENSIONS = ("DBInstanceIdentifier", "InstanceId", "LoadBalancer", "TargetGroup", "HealthCheckId", "Resource")


@dataclass(frozen=True)
class MetricRef:
    namespace: str
    name: str
    dimensions: dict = field(default_factory=dict)
    stat: str = "Average"
    period: int = 300


@dataclass(frozen=True)
class Alarm:
    name: str
    description: str
    state: str
    previous_state: str
    reason: str
    time: str
    region: str
    account_id: str
    severity: str
    topic_arn: str
    threshold: Optional[float]
    comparison: str
    metrics: tuple = ()
    expression: str = ""

    @property
    def primary_metric(self) -> Optional[MetricRef]:
        return self.metrics[0] if self.metrics else None

    @property
    def resource(self) -> str:
        """Human-readable name of the resource the alarm watches, e.g. 'DBInstanceIdentifier=crm-prod'."""
        for metric in self.metrics:
            for key in RESOURCE_DIMENSIONS:
                if key in metric.dimensions:
                    return f"{key}={metric.dimensions[key]}"
        return "unknown"

    @property
    def runbook_key(self) -> Optional[str]:
        match = re.search(r"runbook=([a-z0-9-]+)", self.description or "")
        return match.group(1) if match else None


def _dimensions(raw: list) -> dict:
    # Single-metric alarms send {"name", "value"}; metric math alarms may use either case.
    return {(d.get("name") or d.get("Name")): (d.get("value") or d.get("Value")) for d in raw or []}


def _metrics_from_trigger(trigger: dict) -> tuple:
    if trigger.get("MetricName"):
        return (
            MetricRef(
                namespace=trigger.get("Namespace", ""),
                name=trigger["MetricName"],
                dimensions=_dimensions(trigger.get("Dimensions")),
                stat=trigger.get("Statistic") or trigger.get("ExtendedStatistic") or "Average",
                period=int(trigger.get("Period", 300)),
            ),
        )

    metrics = []
    for entry in trigger.get("Metrics", []):
        metric_stat = entry.get("MetricStat")
        if not metric_stat:
            continue
        metric = metric_stat.get("Metric", {})
        metrics.append(
            MetricRef(
                namespace=metric.get("Namespace", ""),
                name=metric.get("MetricName", ""),
                dimensions=_dimensions(metric.get("Dimensions")),
                stat=metric_stat.get("Stat", "Average"),
                period=int(metric_stat.get("Period", 300)),
            )
        )
    return tuple(metrics)


def _expression_from_trigger(trigger: dict) -> str:
    return next((entry["Expression"] for entry in trigger.get("Metrics", []) if entry.get("Expression")), "")


def parse_sns_record(record: dict) -> Optional[Alarm]:
    """Returns the alarm in an SNS record, or None when the message is not a CloudWatch alarm."""
    sns = record.get("Sns") or {}
    try:
        message = json.loads(sns.get("Message", ""))
    except (TypeError, ValueError):
        return None
    if not isinstance(message, dict) or "AlarmName" not in message:
        return None

    topic_arn = sns.get("TopicArn", "")
    alarm_arn_parts = (message.get("AlarmArn") or "").split(":")
    region = alarm_arn_parts[3] if len(alarm_arn_parts) > 4 else ""
    trigger = message.get("Trigger") or {}
    threshold = trigger.get("Threshold")

    return Alarm(
        name=message["AlarmName"],
        description=message.get("AlarmDescription") or "",
        state=message.get("NewStateValue", ""),
        previous_state=message.get("OldStateValue", ""),
        reason=message.get("NewStateReason", ""),
        time=message.get("StateChangeTime", ""),
        region=region,
        account_id=message.get("AWSAccountId", ""),
        severity="critical" if topic_arn.endswith(CRITICAL_TOPIC_SUFFIXES) else "warning",
        topic_arn=topic_arn,
        threshold=float(threshold) if threshold is not None else None,
        comparison=trigger.get("ComparisonOperator", ""),
        metrics=_metrics_from_trigger(trigger),
        expression=_expression_from_trigger(trigger),
    )
