"""Sample alarms, forecasts and live metric series, shown when AWS is not connected. Always labelled
as demo data in the portal.

The demo changes over time (alarms flip between OK and ALARM, metrics move, forecasts tick down),
so the portal's real-time view can be shown without an AWS account. Everything is computed from the
clock, so all viewers see the same state and nothing is stored.
"""

from __future__ import annotations

import math
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from incident_assistant.alarm import Alarm, MetricRef

REGION = "ap-southeast-1"
WARNING_TOPIC = "arn:aws:sns:ap-southeast-1:000000000000:releaseguard-production-warning"
CRITICAL_TOPIC = "arn:aws:sns:ap-southeast-1:000000000000:releaseguard-production-critical"
SERIES_POINTS = 30


def _alarm(name, topic, description, metric, threshold, comparison, expression=""):
    return Alarm(
        name=name, description=description, state="OK", previous_state="OK", reason="", time="", region=REGION,
        account_id="000000000000", severity="critical" if topic == CRITICAL_TOPIC else "warning", topic_arn=topic,
        threshold=threshold, comparison=comparison, metrics=(metric,), expression=expression,
    )


BASE_ALARMS = [
    _alarm("production-rds-crm-prod-free-storage-critical", CRITICAL_TOPIC,
           "RDS crm-prod free storage is below 10 GiB. Writes will fail when it reaches zero. runbook=db-disk-full",
           MetricRef("AWS/RDS", "FreeStorageSpace", {"DBInstanceIdentifier": "crm-prod"}, "Minimum"), 10.0, "LessThanThreshold", "free / 1073741824"),
    _alarm("production-ec2-web-1-memory-warning", WARNING_TOPIC,
           "Server web-1 memory above 85% for 10 minutes. runbook=memory-pressure",
           MetricRef("CWAgent", "mem_used_percent", {"InstanceId": "i-0demo1234web1"}, "Average"), 85.0, "GreaterThanThreshold"),
    _alarm("production-ec2-web-1-cpu-warning", WARNING_TOPIC,
           "Server web-1 CPU above 85% for 10 minutes. runbook=cpu-spike",
           MetricRef("AWS/EC2", "CPUUtilization", {"InstanceId": "i-0demo1234web1"}, "Average"), 85.0, "GreaterThanThreshold"),
    _alarm("production-alb-app-5xx-critical", CRITICAL_TOPIC,
           "The application returned more than 50 server errors (5xx) in 5 minutes. runbook=deployment-failure",
           MetricRef("AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", {"LoadBalancer": "app/crm-alb/50dc6c495c0c9188"}, "Sum"), 50.0, "GreaterThanThreshold"),
    _alarm("production-rds-crm-prod-connections-warning", WARNING_TOPIC,
           "RDS crm-prod has more than 120 connections (near max_connections). runbook=db-connections",
           MetricRef("AWS/RDS", "DatabaseConnections", {"DBInstanceIdentifier": "crm-prod"}, "Maximum"), 120.0, "GreaterThanThreshold"),
    _alarm("production-forecast-ec2-i-0demo1234web1-full-in-14-days", WARNING_TOPIC,
           "At the current growth rate, disk / on i-0demo1234web1 will be full in under 14 days. runbook=server-disk-full",
           MetricRef("ReleaseGuard/Forecast", "DaysUntilFull", {"Resource": "ec2:i-0demo1234web1:/"}, "Minimum"), 14.0, "LessThanThreshold"),
]


def _minute(now: datetime) -> int:
    return int(now.timestamp() // 60)


def _phase_start(now: datetime, length_minutes: int) -> datetime:
    start = (_minute(now) // length_minutes) * length_minutes
    return datetime.fromtimestamp(start * 60, tz=timezone.utc)


def _state(name: str, now: datetime) -> tuple[str, datetime]:
    """Each demo alarm follows its own simple cycle so changes are visible within minutes."""
    minute = _minute(now)
    if name.endswith("free-storage-critical"):
        return "ALARM", now.replace(minute=0, second=0, microsecond=0)
    if name.endswith("memory-warning"):  # flips every 2 minutes
        return ("ALARM" if (minute // 2) % 2 == 0 else "OK"), _phase_start(now, 2)
    if name.endswith("cpu-warning"):  # in alarm for 1 minute out of every 5
        return ("ALARM" if minute % 5 == 0 else "OK"), _phase_start(now, 1 if minute % 5 == 0 else 5)
    if name.endswith("app-5xx-critical"):  # a short error burst every 7 minutes
        return ("ALARM" if minute % 7 == 3 else "OK"), _phase_start(now, 1)
    if "forecast" in name:
        return "INSUFFICIENT_DATA", now - timedelta(hours=20)
    return "OK", now - timedelta(hours=3)


def _reason(alarm: Alarm, state: str) -> str:
    if state == "ALARM":
        return f"Threshold Crossed: the latest datapoint breached the threshold ({alarm.threshold})."
    if state == "INSUFFICIENT_DATA":
        return "Insufficient Data: 1 datapoint was unknown."
    return f"Threshold Crossed: the latest datapoints are within the threshold ({alarm.threshold})."


def alarms_at(now: datetime) -> list[Alarm]:
    alarms = []
    for alarm in BASE_ALARMS:
        state, since = _state(alarm.name, now)
        alarms.append(replace(alarm, state=state, time=since.isoformat(), reason=_reason(alarm, state)))
    return alarms


def find_alarm(name: str, now: datetime):
    return next((alarm for alarm in alarms_at(now) if alarm.name == name), None)


def forecasts_at(now: datetime) -> list[tuple[str, float]]:
    hours = (now.timestamp() % 86400) / 3600  # ticks down through the day
    return [("rds:crm-prod", round(max(0.5, 3.4 - hours * 0.05), 1)), ("ec2:i-0demo1234web1:/", round(41 - hours * 0.1, 1))]


def _wave(i: int, minute: int, period: float, amplitude: float) -> float:
    return amplitude * math.sin((minute - SERIES_POINTS + i) / period)


def series_at(now: datetime) -> dict[str, list[float]]:
    """30 one-minute points per alarm, oldest first."""
    minute = _minute(now)
    series = {}
    for alarm in alarms_at(now):
        points = []
        for i in range(SERIES_POINTS):
            m = minute - SERIES_POINTS + 1 + i
            if alarm.name.endswith("free-storage-critical"):
                value = 14.6 - (i / SERIES_POINTS) * 6.2 + _wave(i, minute, 3, 0.08)
            elif alarm.name.endswith("memory-warning"):
                in_alarm = (m // 2) % 2 == 0
                value = (88 if in_alarm else 76) + _wave(i, minute, 2.5, 3)
            elif alarm.name.endswith("cpu-warning"):
                value = (91 if m % 5 == 0 else 38) + _wave(i, minute, 1.7, 6)
            elif alarm.name.endswith("app-5xx-critical"):
                value = 64 if m % 7 == 3 else max(0, 3 + _wave(i, minute, 1.3, 3))
            elif alarm.name.endswith("connections-warning"):
                value = 42 + _wave(i, minute, 4, 9)
            else:
                value = 41 - i * 0.003
            points.append(round(value, 2))
        series[alarm.name] = points
    return series


CONTEXTS = {
    "production-rds-crm-prod-free-storage-critical": {
        "metric_window": "last 3 hours", "log_window": "last 30 minutes", "notes": [],
        "metrics": [
            {"metric": "AWS/RDS FreeStorageSpace (Minimum)", "unit": "GiB", "latest": 8.41, "maximum": 14.6, "change_over_window": -6.19,
             "recent_values_oldest_first": [10.9, 10.4, 9.9, 9.4, 9.0, 8.6, 8.41]},
            {"metric": "AWS/RDS WriteIOPS (Average)", "latest": 1840.0, "minimum": 210.0, "change_over_window": 1612.0},
            {"metric": "AWS/RDS CPUUtilization (Average)", "latest": 41.2, "minimum": 12.0},
        ],
        "recent_errors": [
            {"log_group": "/releaseguard/production/laravel", "occurrences": 412, "example": "production.INFO: ImportActivityLogs chunk #### inserted ##### rows into activity_logs"},
            {"log_group": "/releaseguard/production/laravel", "occurrences": 3, "example": "production.ERROR: SQLSTATE[HY000]: General error: 1114 The table 'activity_log_archive' is full"},
        ],
    },
    "production-ec2-web-1-memory-warning": {
        "metric_window": "last 3 hours", "log_window": "last 30 minutes", "notes": [],
        "metrics": [
            {"metric": "CWAgent mem_used_percent (Average)", "latest": 91.2, "minimum": 62.0, "change_over_window": 29.2,
             "recent_values_oldest_first": [62, 66, 70, 74, 79, 83, 88.7, 91.2]},
            {"metric": "AWS/EC2 CPUUtilization (Average)", "latest": 34.0, "minimum": 20.0},
            {"metric": "CWAgent swap_used_percent (Average)", "latest": 0.0},
        ],
        "recent_errors": [
            {"log_group": "/releaseguard/production/laravel", "occurrences": 2, "example": "production.ERROR: Allowed memory size of 536870912 bytes exhausted (tried to allocate 20480 bytes) in ExportLeadsJob"},
            {"log_group": "/releaseguard/production/php-fpm", "occurrences": 5, "example": "WARNING: [pool www] child 8812 exited on signal 9 (SIGKILL) after 10421.4 seconds from start"},
        ],
    },
}

GENERIC_CONTEXT = {"metric_window": "last 3 hours", "log_window": "last 30 minutes", "metrics": [], "recent_errors": [], "notes": ["Demo alarm: no detailed evidence available."]}

CANNED_DIAGNOSIS = {
    "summary": "Sample diagnosis (Claude is not connected): the database lost 6.2 GiB of free space in 3 hours.",
    "probable_cause": "A bulk import job is writing large volumes into activity_logs; write IOPS rose at the same time.",
    "impact": "At this rate storage runs out in about 4 hours. Then every save in the CRM fails.",
    "evidence": ["FreeStorageSpace fell from 14.6 to 8.41 GiB", "WriteIOPS rose from 210 to 1,840", "412 ImportActivityLogs insert log lines"],
    "next_steps": ["Pause the import queue worker", "Increase RDS storage or enable autoscaling", "Agree a retention rule before deleting rows"],
    "confidence": "high",
    "is_likely_false_alarm": False,
}
