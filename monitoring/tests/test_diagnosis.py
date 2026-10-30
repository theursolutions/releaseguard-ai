import json
from types import SimpleNamespace

import pytest

from incident_assistant.alarm import parse_sns_record
from incident_assistant.diagnosis import DEFAULT_MODEL, DIAGNOSIS_SCHEMA, DiagnosisUnavailable, build_prompt, diagnose

DIAGNOSIS = {
    "summary": "Database storage is almost full.",
    "probable_cause": "The activity_logs table grew 6 GiB in 3 hours.",
    "impact": "Writes will fail in about 4 hours.",
    "evidence": ["FreeStorageSpace fell from 14.2 to 8.4 GiB"],
    "next_steps": ["Increase allocated storage", "Find the job inserting rows"],
    "confidence": "medium",
    "is_likely_false_alarm": False,
}


class FakeClient:
    def __init__(self, stop_reason="end_turn", text=json.dumps(DIAGNOSIS)):
        self.calls = []
        self._response = SimpleNamespace(
            stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)] if text else []
        )
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self._response


@pytest.fixture
def alarm(load_event):
    return parse_sns_record(load_event("rds_free_storage_critical.json")["Records"][0])


CONTEXT = {
    "metric_window": "last 3 hours",
    "log_window": "last 30 minutes",
    "metrics": [{"metric": "AWS/RDS FreeStorageSpace (Minimum)", "latest": 8.41, "unit": "GiB"}],
    "recent_errors": [{"log_group": "/releaseguard/production/laravel", "occurrences": 3, "example": "SQLSTATE[HY000] disk full"}],
    "notes": ["Logs partially unavailable"],
}


def test_request_uses_model_effort_schema_and_fallback(alarm):
    client = FakeClient()
    result = diagnose(alarm, CONTEXT, "runbook text", api_key="unused", client=client)

    assert result == DIAGNOSIS
    request = client.calls[0]
    assert request["model"] == DEFAULT_MODEL == "claude-opus-5-5"
    assert request["fallbacks"] == "default"
    assert request["betas"] == ["server-side-fallback-2026-07-01"]
    assert request["output_config"]["effort"] == "medium"
    assert request["output_config"]["format"] == {"type": "json_schema", "schema": DIAGNOSIS_SCHEMA}
    assert "untrusted" in request["system"]


def test_prompt_contains_all_evidence(alarm):
    prompt = build_prompt(alarm, CONTEXT, "Increase storage first")
    assert "<alarm>" in prompt and "production-rds-crm-prod-free-storage-critical" in prompt
    assert "free / 1073741824" in prompt
    assert "8.41" in prompt
    assert "SQLSTATE[HY000] disk full" in prompt
    assert "Logs partially unavailable" in prompt
    assert "Increase storage first" in prompt


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
def test_unusable_responses_raise(alarm, stop_reason):
    with pytest.raises(DiagnosisUnavailable):
        diagnose(alarm, CONTEXT, "", api_key="unused", client=FakeClient(stop_reason=stop_reason))


def test_empty_response_raises(alarm):
    with pytest.raises(DiagnosisUnavailable):
        diagnose(alarm, CONTEXT, "", api_key="unused", client=FakeClient(text=""))


def test_schema_is_strict():
    assert DIAGNOSIS_SCHEMA["additionalProperties"] is False
    assert set(DIAGNOSIS_SCHEMA["required"]) == set(DIAGNOSIS_SCHEMA["properties"])
