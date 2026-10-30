import json
import subprocess
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from releaseguard_ai.anthropic_provider import AnthropicProvider

from app import cloudwatch, demo, main
from app.main import app

TOKEN = "test-service-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
AWS = {"region": "ap-southeast-1", "access_key_id": "AKIAEXAMPLEEXAMPLE", "secret_access_key": "secretsecretsecretsecret", "alarm_prefix": "production-"}
CLAUDE = {"provider": "anthropic", "auth_method": "api_key", "api_key": "sk-ant-test-1234567890"}


class FakeClaude:
    """Fake Anthropic SDK client: records each request and answers with a fixed diagnosis."""

    def __init__(self, diagnosis=None):
        self.calls = []
        response = SimpleNamespace(
            stop_reason="end_turn",
            content=[SimpleNamespace(type="text", text=json.dumps(diagnosis or {"summary": "ok"}))],
            model="claude-opus-5-5",
            usage=SimpleNamespace(input_tokens=10, output_tokens=20),
        )
        create = lambda **kw: (self.calls.append(kw), response)[1]
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=create))
        self.messages = SimpleNamespace(create=create)


def fake_claude(monkeypatch, diagnosis=None):
    fake = FakeClaude(diagnosis)
    monkeypatch.setattr(AnthropicProvider, "client", lambda self, async_client=False: fake)
    return fake

client = TestClient(app)


@pytest.fixture(autouse=True)
def service_token(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)


RAW_ALARMS = [
    {
        "AlarmName": "production-rds-db-free-storage-critical",
        "AlarmArn": "arn:aws:cloudwatch:ap-southeast-1:123456789012:alarm:production-rds-db-free-storage-critical",
        "AlarmDescription": "RDS db free storage is below 10 GiB. runbook=db-disk-full",
        "StateValue": "ALARM",
        "StateReason": "Threshold crossed",
        "StateUpdatedTimestamp": datetime(2026, 10, 24, 9, 0, tzinfo=timezone.utc),
        "AlarmActions": ["arn:aws:sns:ap-southeast-1:123456789012:releaseguard-production-critical"],
        "Threshold": 10.0,
        "ComparisonOperator": "LessThanThreshold",
        "Metrics": [
            {"Id": "free", "MetricStat": {"Metric": {"Namespace": "AWS/RDS", "MetricName": "FreeStorageSpace", "Dimensions": [{"Name": "DBInstanceIdentifier", "Value": "db"}]}, "Period": 300, "Stat": "Minimum"}},
            {"Id": "freegib", "Expression": "free / 1073741824"},
        ],
    },
    {
        "AlarmName": "production-ec2-web-1-cpu-warning",
        "StateValue": "OK",
        "AlarmActions": ["arn:aws:sns:ap-southeast-1:123456789012:releaseguard-production-warning"],
        "MetricName": "CPUUtilization",
        "Namespace": "AWS/EC2",
        "Dimensions": [{"Name": "InstanceId", "Value": "i-1"}],
        "Statistic": "Average",
        "Period": 300,
        "Threshold": 85.0,
    },
]


class FakeCloudWatch:
    def __init__(self):
        self.calls = []

    def get_paginator(self, name):
        outer = self

        class Paginator:
            def paginate(self, **params):
                outer.calls.append(("describe_alarms", params))
                return [{"MetricAlarms": RAW_ALARMS}]

        return Paginator()

    def describe_alarms(self, **params):
        self.calls.append(("describe_alarms", params))
        if params.get("AlarmNames"):
            return {"MetricAlarms": [a for a in RAW_ALARMS if a["AlarmName"] in params["AlarmNames"]]}
        return {"MetricAlarms": RAW_ALARMS[:1]}

    def list_metrics(self, **params):
        return {"Metrics": [{"Dimensions": [{"Name": "Resource", "Value": "rds:db"}]}]}

    def get_metric_data(self, **params):
        ids = [query["Id"] for query in params["MetricDataQueries"]]
        if ids[0].startswith("s"):  # live series for the alarms
            return {"MetricDataResults": [{"Id": "s0", "Values": [12 * 1024**3, 9 * 1024**3]}, {"Id": "s1", "Values": [40.0, 55.5]}]}
        return {"MetricDataResults": [{"Id": "f0", "Values": [6.25]}]}


class FakeSession:
    def __init__(self, cloudwatch_client):
        self.cloudwatch_client = cloudwatch_client

    def client(self, service, region_name=None):
        return self.cloudwatch_client


@pytest.fixture
def fake_aws(monkeypatch):
    fake = FakeCloudWatch()
    monkeypatch.setattr(cloudwatch, "session_for", lambda aws: FakeSession(fake))
    return fake


def test_health_and_manifest():
    assert client.get("/health").json()["service"] == "monitoring-service"
    assert "alarms.diagnose" in client.get("/manifest").json()["capabilities"]


def test_endpoints_require_the_service_token():
    assert client.post("/v1/overview", json={}).status_code == 401
    assert client.post("/v1/alarms/diagnose", json={"alarm_name": "x"}, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_overview_without_aws_returns_labelled_live_demo_data():
    body = client.post("/v1/overview", json={}, headers=AUTH).json()
    assert body["demo"] is True
    assert sum(body["counts"][s] for s in ("ALARM", "OK", "INSUFFICIENT_DATA")) == 6
    assert body["counts"]["critical"] >= 1  # the storage alarm is always critical in the demo
    assert {f["label"] for f in body["forecasts"]} == {"Database crm-prod", "Server i-0demo1234web1 disk /"}
    assert all(len(alarm["series"]) == demo.SERIES_POINTS for alarm in body["alarms"])
    assert body["generated_at"]


def test_demo_changes_over_time_so_live_updates_are_visible():
    base = datetime(2026, 10, 24, 10, 0, tzinfo=timezone.utc)  # minute index is divisible by 4
    memory = lambda when: next(a for a in demo.alarms_at(when) if a.name.endswith("memory-warning"))
    assert memory(base).state == "ALARM"
    assert memory(base + timedelta(minutes=2)).state == "OK"
    assert demo.forecasts_at(base)[0][1] > demo.forecasts_at(base + timedelta(hours=10))[0][1]
    assert demo.series_at(base)["production-ec2-web-1-memory-warning"] != demo.series_at(base + timedelta(minutes=1))["production-ec2-web-1-memory-warning"]


def test_overview_with_aws_reads_cloudwatch(fake_aws):
    body = client.post("/v1/overview", json={"credentials": {"aws": AWS}}, headers=AUTH).json()
    assert body["demo"] is False
    assert fake_aws.calls[0] == ("describe_alarms", {"AlarmTypes": ["MetricAlarm"], "AlarmNamePrefix": "production-"})
    storage = body["alarms"][0]
    assert storage["severity"] == "critical"
    assert storage["resource"] == "DBInstanceIdentifier=db"
    assert storage["runbook"] == "db-disk-full"
    assert "runbook=" not in storage["description"]
    assert body["alarms"][1]["severity"] == "warning"
    assert body["forecasts"] == [{"resource": "rds:db", "label": "Database db", "days": 6.2}]
    assert body["counts"] == {"ALARM": 1, "OK": 1, "INSUFFICIENT_DATA": 0, "critical": 1}
    assert storage["series"] == [12.0, 9.0]  # bytes shown as GiB
    assert body["alarms"][1]["series"] == [40.0, 55.5]


def test_invalid_region_is_rejected():
    response = client.post("/v1/overview", json={"credentials": {"aws": {**AWS, "region": "../../evil"}}}, headers=AUTH)
    assert response.status_code == 422


def test_demo_diagnosis_without_claude_is_canned_and_labelled():
    body = client.post("/v1/alarms/diagnose", json={"alarm_name": "production-rds-crm-prod-free-storage-critical"}, headers=AUTH).json()
    assert body["demo"] is True and body["canned"] is True
    assert body["diagnosis"]["summary"].startswith("Sample diagnosis")


def test_demo_diagnosis_with_api_key_uses_demo_evidence(monkeypatch):
    fake = fake_claude(monkeypatch, {"summary": "Memory leak in ExportLeadsJob"})
    body = client.post("/v1/alarms/diagnose", json={"alarm_name": "production-ec2-web-1-memory-warning", "credentials": {"llm": CLAUDE}}, headers=AUTH).json()
    assert body["canned"] is False
    assert body["diagnosis"]["summary"] == "Memory leak in ExportLeadsJob"
    request = fake.calls[0]
    assert request["model"] == "claude-opus-5-5" and request["fallbacks"] == "default"
    prompt = request["messages"][0]["content"][0]["text"]
    assert "ExportLeadsJob" in prompt  # demo evidence
    assert "<runbook>" in prompt and "memory" in prompt.lower()


def test_diagnosis_works_with_any_provider(monkeypatch):
    from releaseguard_ai import Structured
    from releaseguard_ai.compatible_provider import CompatibleProvider

    seen = {}

    def structured(self, system, parts, schema, *, schema_name, max_tokens):
        seen.update(schema_name=schema_name, prompt=parts[0].text)
        return Structured({"summary": "Disk almost full"}, "llama-4", {})

    monkeypatch.setattr(CompatibleProvider, "structured", structured)
    credentials = {"llm": {"provider": "openai_compatible", "name": "Groq", "base_url": "https://api.groq.com/openai/v1", "api_key": "gsk_x", "model": "llama-4"}}
    body = client.post("/v1/alarms/diagnose", json={"alarm_name": "production-rds-crm-prod-free-storage-critical", "credentials": credentials}, headers=AUTH).json()
    assert body["diagnosis"] == {"summary": "Disk almost full"} and body["model"] == "llama-4"
    assert seen["schema_name"] == "alarm_diagnosis" and "<alarm>" in seen["prompt"]


def test_real_diagnosis_collects_context_with_portal_credentials(fake_aws, monkeypatch):
    captured = {}
    monkeypatch.setattr(main, "collect_context", lambda alarm, session, log_group_prefix: captured.update(alarm=alarm, prefix=log_group_prefix) or {"metrics": [], "recent_errors": [], "notes": []})
    fake_claude(monkeypatch)

    body = client.post(
        "/v1/alarms/diagnose",
        json={"alarm_name": "production-rds-db-free-storage-critical", "credentials": {"aws": {**AWS, "log_group_prefix": "/releaseguard/production/"}, "llm": CLAUDE}},
        headers=AUTH,
    ).json()
    assert body["demo"] is False
    assert captured["alarm"].expression == "free / 1073741824"
    assert captured["alarm"].primary_metric.dimensions == {"DBInstanceIdentifier": "db"}
    assert captured["prefix"] == "/releaseguard/production/"


def test_real_alarm_needs_claude(fake_aws, monkeypatch):
    monkeypatch.setattr(main, "collect_context", lambda *a, **k: {})
    response = client.post("/v1/alarms/diagnose", json={"alarm_name": "production-rds-db-free-storage-critical", "credentials": {"aws": AWS}}, headers=AUTH)
    assert response.status_code == 422


def test_unknown_alarm_is_404(fake_aws):
    assert client.post("/v1/alarms/diagnose", json={"alarm_name": "nope"}, headers=AUTH).status_code == 404
    assert client.post("/v1/alarms/diagnose", json={"alarm_name": "nope", "credentials": {"aws": AWS}}, headers=AUTH).status_code == 404


def test_slack_test_only_accepts_slack_webhooks():
    body = client.post("/v1/connections/test", json={"connection": "slack", "credentials": {"slack": {"webhook_url": "https://evil.example.com/hook"}}}, headers=AUTH).json()
    assert body == {"ok": False, "message": "The webhook URL must start with https://hooks.slack.com/"}


def test_aws_connection_test(fake_aws):
    body = client.post("/v1/connections/test", json={"connection": "aws", "credentials": {"aws": AWS}}, headers=AUTH).json()
    assert body == {"ok": True, "message": "Connected to CloudWatch in ap-southeast-1."}


def test_bedrock_diagnosis_uses_bedrock_model_without_server_fallback(monkeypatch):
    fake = fake_claude(monkeypatch)
    credentials = {"llm": {"provider": "anthropic", "auth_method": "bedrock", "bedrock_region": "ap-southeast-1", "bedrock_access_key_id": "AKIAEXAMPLEEXAMPLE", "bedrock_secret_access_key": "x" * 20}}
    client.post("/v1/alarms/diagnose", json={"alarm_name": "production-rds-crm-prod-free-storage-critical", "credentials": credentials}, headers=AUTH)
    request = fake.calls[0]
    assert request["model"] == "anthropic.claude-opus-5-5"
    assert "fallbacks" not in request and "betas" not in request


def test_unsupported_sign_in_methods_are_rejected():
    credentials = {"llm": {"provider": "anthropic", "auth_method": "claude_code", "oauth_token": "sk-ant-oat01-x"}}
    response = client.post("/v1/alarms/diagnose", json={"alarm_name": "production-rds-crm-prod-free-storage-critical", "credentials": credentials}, headers=AUTH)
    assert response.status_code == 422
