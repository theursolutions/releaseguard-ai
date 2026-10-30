"""Collects the evidence Claude needs: the alarm's metric, related metrics and recent error logs."""

from __future__ import annotations

import logging
import os
import re
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

import boto3

from .alarm import Alarm, MetricRef
from .redact import redact

logger = logging.getLogger(__name__)

METRIC_WINDOW = timedelta(hours=3)
LOG_WINDOW = timedelta(minutes=30)
LOG_QUERY_TIMEOUT_SECONDS = 20
MAX_LOG_GROUPS = 10
MAX_ERROR_PATTERNS = 15
SERIES_TAIL = 12

LOG_QUERY = (
    "fields @timestamp, @message, @log "
    "| filter @message like /(?i)(error|exception|critical|fatal|emergency|alert|timeout|refused)/ "
    "| sort @timestamp desc | limit 200"
)

# Metrics read alongside the alarm's own metric, so Claude sees the whole picture.
# Each entry: (namespace, metric name, statistic, dimension keys copied from the alarm).
RELATED_METRICS = {
    "rds": [
        ("AWS/RDS", "CPUUtilization", "Average", ("DBInstanceIdentifier",)),
        ("AWS/RDS", "FreeStorageSpace", "Minimum", ("DBInstanceIdentifier",)),
        ("AWS/RDS", "DatabaseConnections", "Maximum", ("DBInstanceIdentifier",)),
        ("AWS/RDS", "FreeableMemory", "Minimum", ("DBInstanceIdentifier",)),
        ("AWS/RDS", "ReadLatency", "Average", ("DBInstanceIdentifier",)),
        ("AWS/RDS", "WriteLatency", "Average", ("DBInstanceIdentifier",)),
        ("AWS/RDS", "ReadIOPS", "Average", ("DBInstanceIdentifier",)),
        ("AWS/RDS", "WriteIOPS", "Average", ("DBInstanceIdentifier",)),
    ],
    "ec2": [
        ("AWS/EC2", "CPUUtilization", "Average", ("InstanceId",)),
        ("AWS/EC2", "StatusCheckFailed", "Maximum", ("InstanceId",)),
        ("CWAgent", "mem_used_percent", "Average", ("InstanceId",)),
        ("CWAgent", "swap_used_percent", "Average", ("InstanceId",)),
        ("CWAgent", "disk_used_percent", "Average", ("InstanceId", "path")),
    ],
    "alb": [
        ("AWS/ApplicationELB", "RequestCount", "Sum", ("LoadBalancer",)),
        ("AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "Sum", ("LoadBalancer",)),
        ("AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", "Sum", ("LoadBalancer",)),
        ("AWS/ApplicationELB", "TargetResponseTime", "p95", ("LoadBalancer",)),
        ("AWS/ApplicationELB", "UnHealthyHostCount", "Maximum", ("LoadBalancer", "TargetGroup")),
    ],
}

# Byte metrics are converted so Claude reads "4.2 GiB", not "4509715660.8".
UNIT_SCALES = {"FreeStorageSpace": (1024**3, "GiB"), "FreeableMemory": (1024**2, "MiB")}


def _resource_family(dimensions: dict) -> str | None:
    if "DBInstanceIdentifier" in dimensions:
        return "rds"
    if "InstanceId" in dimensions:
        return "ec2"
    if "LoadBalancer" in dimensions:
        return "alb"
    return None


def related_metric_refs(alarm: Alarm) -> list[MetricRef]:
    """The alarm's own metrics followed by related metrics for the same resource, without duplicates."""
    refs = list(alarm.metrics)
    seen = {(m.namespace, m.name) for m in refs}
    for metric in alarm.metrics:
        dimensions = dict(metric.dimensions)
        dimensions.setdefault("path", "/")
        for namespace, name, stat, keys in RELATED_METRICS.get(_resource_family(metric.dimensions) or "", []):
            if (namespace, name) in seen or not all(key in dimensions for key in keys):
                continue
            seen.add((namespace, name))
            refs.append(MetricRef(namespace, name, {key: dimensions[key] for key in keys}, stat, 300))
    return refs


def summarise_series(ref: MetricRef, timestamps: list, values: list) -> dict:
    scale, unit = UNIT_SCALES.get(ref.name, (1, ""))
    points = [round(value / scale, 3) for _, value in sorted(zip(timestamps, values))]
    summary = {
        "metric": f"{ref.namespace} {ref.name} ({ref.stat})",
        "dimensions": ref.dimensions,
        "unit": unit or None,
        "datapoints": len(points),
    }
    if points:
        summary.update(
            latest=points[-1],
            minimum=min(points),
            maximum=max(points),
            average=round(sum(points) / len(points), 3),
            change_over_window=round(points[-1] - points[0], 3),
            recent_values_oldest_first=points[-SERIES_TAIL:],
        )
    return summary


def collect_metrics(cloudwatch, refs: list[MetricRef], now: datetime) -> list[dict]:
    queries = []
    for index, ref in enumerate(refs):
        queries.append(
            {
                "Id": f"m{index}",
                "MetricStat": {
                    "Metric": {
                        "Namespace": ref.namespace,
                        "MetricName": ref.name,
                        "Dimensions": [{"Name": key, "Value": value} for key, value in ref.dimensions.items()],
                    },
                    "Period": max(60, ref.period),
                    "Stat": ref.stat,
                },
                "ReturnData": True,
            }
        )
    response = cloudwatch.get_metric_data(
        MetricDataQueries=queries, StartTime=now - METRIC_WINDOW, EndTime=now, ScanBy="TimestampAscending"
    )
    results = {result["Id"]: result for result in response.get("MetricDataResults", [])}
    return [
        summarise_series(ref, results.get(f"m{i}", {}).get("Timestamps", []), results.get(f"m{i}", {}).get("Values", []))
        for i, ref in enumerate(refs)
    ]


def _signature(message: str) -> str:
    """Groups log lines that differ only by numbers, IDs or timestamps."""
    return re.sub(r"\d+", "#", message)[:160]


def group_error_lines(rows: list[dict]) -> list[dict]:
    counts, examples, latest = Counter(), {}, {}
    for row in rows:
        message = redact(row.get("@message", "").strip())
        if not message:
            continue
        key = (row.get("@log", "").split(":")[-1], _signature(message))
        counts[key] += 1
        examples.setdefault(key, message)
        latest.setdefault(key, row.get("@timestamp", ""))
    return [
        {"log_group": key[0], "occurrences": count, "latest_at": latest[key], "example": examples[key]}
        for key, count in counts.most_common(MAX_ERROR_PATTERNS)
    ]


def collect_recent_errors(logs, log_group_prefix: str, now: datetime) -> list[dict]:
    groups = logs.describe_log_groups(logGroupNamePrefix=log_group_prefix, limit=MAX_LOG_GROUPS).get("logGroups", [])
    names = [group["logGroupName"] for group in groups]
    if not names:
        return []

    query_id = logs.start_query(
        logGroupNames=names,
        startTime=int((now - LOG_WINDOW).timestamp()),
        endTime=int(now.timestamp()),
        queryString=LOG_QUERY,
    )["queryId"]

    deadline = time.monotonic() + LOG_QUERY_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        result = logs.get_query_results(queryId=query_id)
        if result["status"] in ("Complete", "Failed", "Cancelled", "Timeout"):
            rows = [{field["field"]: field["value"] for field in row} for row in result.get("results", [])]
            return group_error_lines(rows)
        time.sleep(1)

    logs.stop_query(queryId=query_id)
    return []


def collect_context(alarm: Alarm, session=None, log_group_prefix: str | None = None) -> dict:
    """Gathers metrics and logs. Each source fails independently so a partial picture is still sent.

    The Lambda uses its own role (no session given). The portal's monitoring service passes a
    session built from the credentials the portal sends, plus the log group prefix.
    """
    now = datetime.now(timezone.utc)
    context = {"metric_window": "last 3 hours", "log_window": "last 30 minutes", "metrics": [], "recent_errors": [], "notes": []}
    metrics_session = session or boto3.session.Session(region_name=alarm.region or None)

    try:
        context["metrics"] = collect_metrics(metrics_session.client("cloudwatch", region_name=alarm.region or None), related_metric_refs(alarm), now)
    except Exception as error:  # noqa: BLE001 - one failed source must not block the alert
        logger.exception("Metric collection failed")
        context["notes"].append(f"Metrics unavailable: {type(error).__name__}")

    prefix = log_group_prefix if log_group_prefix is not None else os.environ.get("LOG_GROUP_PREFIX", "")
    if not prefix:
        context["notes"].append("No application log groups configured.")
        return context
    try:
        logs = session.client("logs") if session else boto3.client("logs")
        context["recent_errors"] = collect_recent_errors(logs, prefix, now)
        if not context["recent_errors"]:
            context["notes"].append("No error lines found in application logs in the last 30 minutes.")
    except Exception as error:  # noqa: BLE001
        logger.exception("Log collection failed")
        context["notes"].append(f"Logs unavailable: {type(error).__name__}")
    return context
