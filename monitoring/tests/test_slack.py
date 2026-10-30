import json

from incident_assistant.alarm import parse_sns_record
from incident_assistant.slack import SECTION_LIMIT, alarm_console_url, build_message, escape

DIAGNOSIS = {
    "summary": "Storage <almost> full & growing",
    "probable_cause": "Log table growth",
    "impact": "Writes fail soon",
    "evidence": ["Free storage 8.4 GiB"],
    "next_steps": ["Increase storage", "Prune logs"],
    "confidence": "high",
    "is_likely_false_alarm": True,
}


def _alarm(load_event, name):
    return parse_sns_record(load_event(name)["Records"][0])


def _text(message):
    return json.dumps(message)


def test_alarm_message_with_diagnosis(load_event, monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("RUNBOOK_BASE_URL", "https://bitbucket.org/acme/releaseguard-ai/src/main/runbooks/")
    message = build_message(_alarm(load_event, "rds_free_storage_critical.json"), DIAGNOSIS, "db-disk-full")

    assert message["text"].startswith(":red_circle: CRITICAL: production-rds-crm-prod-free-storage-critical")
    body = _text(message)
    assert "AI diagnosis" in body and "confidence: high" in body
    assert "1. Increase storage" in body and "2. Prune logs" in body
    assert "likely false alarm" in body
    assert "Verify before acting" in body
    buttons = [element["url"] for block in message["blocks"] if block["type"] == "actions" for element in block["elements"]]
    assert buttons[1] == "https://bitbucket.org/acme/releaseguard-ai/src/main/runbooks/db-disk-full.md"


def test_user_content_is_escaped(load_event):
    body = _text(build_message(_alarm(load_event, "rds_free_storage_critical.json"), DIAGNOSIS, None))
    assert "&lt;almost&gt; full &amp; growing" in body
    assert "<almost>" not in body


def test_recovery_message_has_no_diagnosis(load_event, monkeypatch):
    monkeypatch.delenv("RUNBOOK_BASE_URL", raising=False)
    message = build_message(_alarm(load_event, "ec2_cpu_warning_ok.json"), None, "cpu-spike")
    assert message["text"].startswith(":white_check_mark: RESOLVED")
    assert "AI diagnosis" not in _text(message)
    actions = [block for block in message["blocks"] if block["type"] == "actions"][0]
    assert len(actions["elements"]) == 1  # no runbook button without a base URL


def test_diagnosis_error_is_shown(load_event):
    message = build_message(_alarm(load_event, "rds_free_storage_critical.json"), None, None, "AI diagnosis unavailable")
    assert ":warning: AI diagnosis unavailable" in _text(message)


def test_long_text_is_clipped_to_slack_limits(load_event):
    long_diagnosis = dict(DIAGNOSIS, summary="x" * 10000)
    message = build_message(_alarm(load_event, "rds_free_storage_critical.json"), long_diagnosis, None)
    for block in message["blocks"]:
        if block["type"] == "section" and "text" in block:
            assert len(block["text"]["text"]) <= SECTION_LIMIT
    assert len(message["blocks"][0]["text"]["text"]) <= 150


def test_console_url_encodes_alarm_name(load_event):
    url = alarm_console_url(_alarm(load_event, "rds_free_storage_critical.json"))
    assert url.startswith("https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#alarmsV2:alarm/")
    assert escape("a<b") == "a&lt;b"
