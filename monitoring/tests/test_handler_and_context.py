from datetime import datetime, timedelta, timezone

import pytest

from incident_assistant import handler
from incident_assistant.alarm import MetricRef, parse_sns_record
from incident_assistant.context import collect_metrics, group_error_lines, related_metric_refs


@pytest.fixture
def wiring(monkeypatch):
    """Replaces every outside call (AWS, Claude, Slack) with recorders."""
    monkeypatch.setenv("ANTHROPIC_SECRET_ARN", "arn:anthropic")
    monkeypatch.setenv("SLACK_SECRET_ARN", "arn:slack")
    posted, diagnosed = [], []
    monkeypatch.setattr(handler, "get_secret", lambda arn: f"secret-for-{arn}")
    monkeypatch.setattr(handler, "collect_context", lambda alarm: {"metrics": [], "recent_errors": [], "notes": []})
    monkeypatch.setattr(handler, "post", lambda url, message: posted.append((url, message)))

    def fake_diagnose(alarm, context, runbook, api_key, model):
        diagnosed.append({"alarm": alarm.name, "runbook": runbook, "api_key": api_key, "model": model})
        return {"summary": "s", "probable_cause": "c", "impact": "i", "evidence": [], "next_steps": [], "confidence": "low", "is_likely_false_alarm": False}

    monkeypatch.setattr(handler, "diagnose", fake_diagnose)
    return posted, diagnosed


def test_alarm_is_diagnosed_and_posted(load_event, wiring):
    posted, diagnosed = wiring
    assert handler.lambda_handler(load_event("rds_free_storage_critical.json"), None) == {"handled": 1}

    assert diagnosed[0]["api_key"] == "secret-for-arn:anthropic"
    assert diagnosed[0]["model"] == "claude-opus-5-5"
    assert "Runbook: database disk" in diagnosed[0]["runbook"]
    url, message = posted[0]
    assert url == "secret-for-arn:slack"
    assert "AI diagnosis" in str(message)


def test_recovery_is_posted_without_calling_claude(load_event, wiring):
    posted, diagnosed = wiring
    handler.lambda_handler(load_event("ec2_cpu_warning_ok.json"), None)
    assert diagnosed == []
    assert posted[0][1]["text"].startswith(":white_check_mark: RESOLVED")


def test_alert_still_posted_when_diagnosis_fails(load_event, wiring, monkeypatch):
    posted, _ = wiring

    def broken(*args, **kwargs):
        raise TimeoutError("Claude timed out")

    monkeypatch.setattr(handler, "diagnose", broken)
    handler.lambda_handler(load_event("rds_free_storage_critical.json"), None)
    assert "AI diagnosis unavailable" in str(posted[0][1])


def test_non_alarm_messages_are_skipped(wiring):
    posted, _ = wiring
    assert handler.lambda_handler({"Records": [{"Sns": {"Message": "hello"}}]}, None) == {"handled": 0}
    assert posted == []


def test_related_metrics_for_rds_alarm(load_event):
    alarm = parse_sns_record(load_event("rds_free_storage_critical.json")["Records"][0])
    refs = related_metric_refs(alarm)
    names = [ref.name for ref in refs]
    assert names[0] == "FreeStorageSpace"
    assert names.count("FreeStorageSpace") == 1
    assert {"CPUUtilization", "DatabaseConnections", "FreeableMemory", "ReadLatency"} <= set(names)
    assert all(ref.dimensions == {"DBInstanceIdentifier": "crm-prod"} for ref in refs)


def test_related_metrics_skip_target_group_metrics_without_target_group():
    alarm_metric = MetricRef("AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", {"LoadBalancer": "app/x/1"}, "Sum")
    alarm = parse_sns_record(
        {"Sns": {"Message": '{"AlarmName": "a", "Trigger": {"MetricName": "HTTPCode_Target_5XX_Count", "Namespace": "AWS/ApplicationELB", "Dimensions": [{"name": "LoadBalancer", "value": "app/x/1"}]}}'}}
    )
    names = [ref.name for ref in related_metric_refs(alarm)]
    assert alarm_metric.name in names
    assert "UnHealthyHostCount" not in names


def test_metric_summary_converts_bytes_to_gib():
    now = datetime(2026, 10, 23, 9, 0, tzinfo=timezone.utc)
    gib = 1024**3

    class FakeCloudWatch:
        def get_metric_data(self, **kwargs):
            self.kwargs = kwargs
            return {"MetricDataResults": [{"Id": "m0", "Timestamps": [now - timedelta(minutes=10), now], "Values": [12 * gib, 8 * gib]}]}

    cloudwatch = FakeCloudWatch()
    summary = collect_metrics(cloudwatch, [MetricRef("AWS/RDS", "FreeStorageSpace", {"DBInstanceIdentifier": "db"}, "Minimum")], now)[0]
    assert summary["unit"] == "GiB"
    assert summary["latest"] == 8.0
    assert summary["change_over_window"] == -4.0
    assert cloudwatch.kwargs["MetricDataQueries"][0]["MetricStat"]["Stat"] == "Minimum"


def test_error_lines_are_grouped_and_redacted():
    rows = [
        {"@message": "[2026-10-23 09:00:01] production.ERROR: SQLSTATE[HY000] user 101 ali@example.com", "@log": "123:/releaseguard/production/laravel", "@timestamp": "t2"},
        {"@message": "[2026-10-23 09:00:05] production.ERROR: SQLSTATE[HY000] user 202 bob@example.com", "@log": "123:/releaseguard/production/laravel", "@timestamp": "t1"},
        {"@message": "upstream timed out", "@log": "123:/releaseguard/production/nginx-error", "@timestamp": "t0"},
    ]
    groups = group_error_lines(rows)
    assert groups[0]["occurrences"] == 2
    assert groups[0]["log_group"] == "/releaseguard/production/laravel"
    assert "ali@example.com" not in groups[0]["example"]
    assert len(groups) == 2
