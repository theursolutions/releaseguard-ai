"""Scheduled Lambda: publishes ReleaseGuard/Forecast DaysUntilFull for each configured disk.

CloudWatch alarms on that metric then flow through the normal alert path (Slack + AI diagnosis).

Environment:
  RDS_INSTANCES   comma-separated RDS instance identifiers, e.g. "crm-prod"
  EC2_DISKS       comma-separated "instance-id:path" pairs, e.g. "i-0abc123:/,i-0abc123:/data"
  LOOKBACK_DAYS   history used for the trend (default 14)
  NAMESPACE       metric namespace (default ReleaseGuard/Forecast)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

import boto3

from .forecast import days_until_empty, days_until_full

logger = logging.getLogger()
logger.setLevel(logging.INFO)

HOUR = 3600


def _split(value: str) -> list[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def _series(cloudwatch, namespace: str, name: str, dimensions: dict, stat: str, start: datetime, end: datetime):
    response = cloudwatch.get_metric_data(
        MetricDataQueries=[
            {
                "Id": "series",
                "MetricStat": {
                    "Metric": {
                        "Namespace": namespace,
                        "MetricName": name,
                        "Dimensions": [{"Name": key, "Value": value} for key, value in dimensions.items()],
                    },
                    "Period": HOUR,
                    "Stat": stat,
                },
            }
        ],
        StartTime=start,
        EndTime=end,
        ScanBy="TimestampAscending",
    )
    result = response["MetricDataResults"][0]
    pairs = sorted(zip(result.get("Timestamps", []), result.get("Values", [])))
    days = [(timestamp - start).total_seconds() / 86400 for timestamp, _ in pairs]
    return days, [value for _, value in pairs]


def forecast_targets(cloudwatch, rds_instances: list[str], ec2_disks: list[str], start: datetime, end: datetime) -> dict:
    """Returns {resource label: days until full, or None when there isn't enough history}."""
    results = {}
    for instance in rds_instances:
        days, values = _series(cloudwatch, "AWS/RDS", "FreeStorageSpace", {"DBInstanceIdentifier": instance}, "Minimum", start, end)
        results[f"rds:{instance}"] = days_until_empty(days, values)
    for disk in ec2_disks:
        instance_id, _, path = disk.partition(":")
        dimensions = {"InstanceId": instance_id, "path": path or "/"}
        days, values = _series(cloudwatch, "CWAgent", "disk_used_percent", dimensions, "Maximum", start, end)
        results[f"ec2:{instance_id}:{path or '/'}"] = days_until_full(days, values)
    return results


def lambda_handler(_event, _context) -> dict:
    cloudwatch = boto3.client("cloudwatch")
    namespace = os.environ.get("NAMESPACE", "ReleaseGuard/Forecast")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=int(os.environ.get("LOOKBACK_DAYS", "14")))

    results = forecast_targets(cloudwatch, _split(os.environ.get("RDS_INSTANCES", "")), _split(os.environ.get("EC2_DISKS", "")), start, end)

    metric_data = [
        {"MetricName": "DaysUntilFull", "Dimensions": [{"Name": "Resource", "Value": resource}], "Value": days, "Unit": "Count", "Timestamp": end}
        for resource, days in results.items()
        if days is not None
    ]
    if metric_data:
        cloudwatch.put_metric_data(Namespace=namespace, MetricData=metric_data)

    for resource, days in results.items():
        logger.info("%s: %s", resource, f"{days} days until full" if days is not None else "not enough history yet")
    return {"forecasts": results}
