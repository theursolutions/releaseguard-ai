"""Reads ReleaseGuard alarms and forecasts from CloudWatch with the credentials the portal sends."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import boto3

from incident_assistant.alarm import CRITICAL_TOPIC_SUFFIXES, Alarm, MetricRef

FORECAST_NAMESPACE = "ReleaseGuard/Forecast"
MAX_ALARMS = 200


def session_for(aws: dict) -> boto3.session.Session:
    return boto3.session.Session(
        aws_access_key_id=aws["access_key_id"],
        aws_secret_access_key=aws["secret_access_key"],
        region_name=aws["region"],
    )


def _dimensions(raw: list) -> dict:
    return {d["Name"]: d["Value"] for d in raw or []}


def _metrics(raw: dict) -> tuple:
    if raw.get("MetricName"):
        return (MetricRef(raw.get("Namespace", ""), raw["MetricName"], _dimensions(raw.get("Dimensions")), raw.get("Statistic") or raw.get("ExtendedStatistic") or "Average", int(raw.get("Period", 300))),)
    refs = []
    for entry in raw.get("Metrics", []):
        stat = entry.get("MetricStat")
        if stat:
            metric = stat.get("Metric", {})
            refs.append(MetricRef(metric.get("Namespace", ""), metric.get("MetricName", ""), _dimensions(metric.get("Dimensions")), stat.get("Stat", "Average"), int(stat.get("Period", 300))))
    return tuple(refs)


def _severity(raw: dict) -> str:
    return "critical" if any(arn.endswith(CRITICAL_TOPIC_SUFFIXES) for arn in raw.get("AlarmActions", [])) else "warning"


def to_alarm(raw: dict, region: str) -> Alarm:
    """Converts a DescribeAlarms entry into the incident assistant's Alarm."""
    expression = next((m["Expression"] for m in raw.get("Metrics", []) if m.get("Expression")), "")
    updated = raw.get("StateUpdatedTimestamp")
    arn_parts = (raw.get("AlarmArn") or "").split(":")
    return Alarm(
        name=raw["AlarmName"],
        description=raw.get("AlarmDescription") or "",
        state=raw.get("StateValue", ""),
        previous_state="",
        reason=raw.get("StateReason", ""),
        time=updated.isoformat() if isinstance(updated, datetime) else str(updated or ""),
        region=region,
        account_id=arn_parts[4] if len(arn_parts) > 4 else "",
        severity=_severity(raw),
        topic_arn=next(iter(raw.get("AlarmActions", [])), ""),
        threshold=raw.get("Threshold"),
        comparison=raw.get("ComparisonOperator", ""),
        metrics=_metrics(raw),
        expression=expression,
    )


def summarise(alarm: Alarm) -> dict:
    """The alarm as the portal shows it."""
    metric = alarm.primary_metric
    runbook = re.search(r"runbook=([a-z0-9-]+)", alarm.description or "")
    return {
        "name": alarm.name,
        "state": alarm.state,
        "severity": alarm.severity,
        "reason": alarm.reason,
        "updated_at": alarm.time,
        "description": re.sub(r"\s*runbook=[a-z0-9-]+", "", alarm.description or "").strip(),
        "resource": alarm.resource,
        "metric": f"{metric.namespace} {metric.name}" if metric else "",
        "runbook": runbook.group(1) if runbook else None,
    }


def list_alarms(session, region: str, prefix: Optional[str]) -> list[Alarm]:
    paginator = session.client("cloudwatch", region_name=region).get_paginator("describe_alarms")
    params = {"AlarmTypes": ["MetricAlarm"]}
    if prefix:
        params["AlarmNamePrefix"] = prefix
    alarms = []
    for page in paginator.paginate(**params):
        alarms.extend(to_alarm(raw, region) for raw in page.get("MetricAlarms", []))
        if len(alarms) >= MAX_ALARMS:
            break
    return alarms[:MAX_ALARMS]


def get_alarm(session, region: str, name: str) -> Optional[Alarm]:
    response = session.client("cloudwatch", region_name=region).describe_alarms(AlarmNames=[name], AlarmTypes=["MetricAlarm"])
    raws = response.get("MetricAlarms", [])
    return to_alarm(raws[0], region) if raws else None


def list_forecasts(session, region: str) -> list[dict]:
    cloudwatch = session.client("cloudwatch", region_name=region)
    resources = [
        _dimensions(metric.get("Dimensions")).get("Resource")
        for metric in cloudwatch.list_metrics(Namespace=FORECAST_NAMESPACE, MetricName="DaysUntilFull").get("Metrics", [])
    ]
    resources = sorted({r for r in resources if r})
    if not resources:
        return []

    now = datetime.now(timezone.utc)
    response = cloudwatch.get_metric_data(
        MetricDataQueries=[
            {
                "Id": f"f{i}",
                "MetricStat": {
                    "Metric": {"Namespace": FORECAST_NAMESPACE, "MetricName": "DaysUntilFull", "Dimensions": [{"Name": "Resource", "Value": resource}]},
                    "Period": 21600,
                    "Stat": "Minimum",
                },
            }
            for i, resource in enumerate(resources)
        ],
        StartTime=now - timedelta(days=2),
        EndTime=now,
        ScanBy="TimestampDescending",
    )
    latest = {result["Id"]: (result.get("Values") or [None])[0] for result in response.get("MetricDataResults", [])}
    return [forecast_entry(resource, latest.get(f"f{i}")) for i, resource in enumerate(resources)]


def forecast_entry(resource: str, days: Optional[float]) -> dict:
    kind, _, rest = resource.partition(":")
    label = f"Database {rest}" if kind == "rds" else f"Server {rest.replace(':', ' disk ')}"
    return {"resource": resource, "label": label, "days": None if days is None else round(days, 1)}


SERIES_WINDOW = timedelta(minutes=60)
MAX_SERIES = 50
# Byte metrics are shown in GiB/MiB, matching the incident assistant.
SERIES_SCALES = {"FreeStorageSpace": 1024**3, "FreeableMemory": 1024**2}


def recent_series(session, region: str, alarms: list[Alarm]) -> dict[str, list[float]]:
    """Last hour of each alarm's metric, oldest first, for the portal's live sparklines."""
    with_metric = [alarm for alarm in alarms if alarm.primary_metric][:MAX_SERIES]
    if not with_metric:
        return {}

    now = datetime.now(timezone.utc)
    queries = []
    for i, alarm in enumerate(with_metric):
        metric = alarm.primary_metric
        queries.append({
            "Id": f"s{i}",
            "MetricStat": {
                "Metric": {"Namespace": metric.namespace, "MetricName": metric.name, "Dimensions": [{"Name": k, "Value": v} for k, v in metric.dimensions.items()]},
                "Period": max(60, min(metric.period, 300)),
                "Stat": metric.stat,
            },
        })
    response = session.client("cloudwatch", region_name=region).get_metric_data(
        MetricDataQueries=queries, StartTime=now - SERIES_WINDOW, EndTime=now, ScanBy="TimestampAscending"
    )
    by_id = {result["Id"]: result.get("Values", []) for result in response.get("MetricDataResults", [])}
    return {
        alarm.name: [round(value / SERIES_SCALES.get(alarm.primary_metric.name, 1), 2) for value in by_id.get(f"s{i}", [])]
        for i, alarm in enumerate(with_metric)
    }


def connection_check(session, region: str) -> str:
    session.client("cloudwatch", region_name=region).describe_alarms(MaxRecords=1)
    return f"Connected to CloudWatch in {region}."
