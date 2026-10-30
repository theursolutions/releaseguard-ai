"""Chooses the runbook for an alarm and loads its text."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from .alarm import Alarm

RUNBOOK_DIR = Path(__file__).parent / "runbooks"

_KEY_BY_METRIC = {
    "FreeStorageSpace": "db-disk-full",
    "disk_used_percent": "server-disk-full",
    "CPUUtilization": "cpu-spike",
    "ReadLatency": "cpu-spike",
    "WriteLatency": "cpu-spike",
    "mem_used_percent": "memory-pressure",
    "swap_used_percent": "memory-pressure",
    "FreeableMemory": "memory-pressure",
    "DatabaseConnections": "db-connections",
    "HTTPCode_Target_5XX_Count": "deployment-failure",
    "HTTPCode_ELB_5XX_Count": "deployment-failure",
    "TargetResponseTime": "deployment-failure",
    "UnHealthyHostCount": "deployment-failure",
    "HealthCheckStatus": "deployment-failure",
    "StatusCheckFailed": "deployment-failure",
}


def runbook_key_for(alarm: Alarm) -> Optional[str]:
    if alarm.runbook_key:
        return alarm.runbook_key
    metric = alarm.primary_metric
    if metric is None:
        return None
    if metric.name == "DaysUntilFull":
        return "db-disk-full" if str(metric.dimensions.get("Resource", "")).startswith("rds:") else "server-disk-full"
    return _KEY_BY_METRIC.get(metric.name)


def load_runbook(key: Optional[str]) -> str:
    if not key:
        return ""
    path = RUNBOOK_DIR / f"{key}.md"
    # The key comes from the alarm description, so never read outside the runbook folder.
    if path.resolve().parent != RUNBOOK_DIR.resolve() or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")
