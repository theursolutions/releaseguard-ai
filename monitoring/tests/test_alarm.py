from incident_assistant.alarm import parse_sns_record
from incident_assistant.runbooks import load_runbook, runbook_key_for


def test_parses_metric_math_alarm(load_event):
    alarm = parse_sns_record(load_event("rds_free_storage_critical.json")["Records"][0])

    assert alarm.name == "production-rds-crm-prod-free-storage-critical"
    assert alarm.state == "ALARM"
    assert alarm.previous_state == "OK"
    assert alarm.severity == "critical"
    assert alarm.region == "ap-southeast-1"
    assert alarm.threshold == 10.0
    assert alarm.expression == "free / 1073741824"
    assert alarm.resource == "DBInstanceIdentifier=crm-prod"
    assert alarm.primary_metric.name == "FreeStorageSpace"
    assert alarm.primary_metric.stat == "Minimum"


def test_parses_single_metric_alarm_as_warning(load_event):
    alarm = parse_sns_record(load_event("ec2_cpu_warning_ok.json")["Records"][0])

    assert alarm.severity == "warning"
    assert alarm.state == "OK"
    assert alarm.primary_metric.namespace == "AWS/EC2"
    assert alarm.primary_metric.dimensions == {"InstanceId": "i-0abc1234def567890"}
    assert alarm.resource == "InstanceId=i-0abc1234def567890"


def test_uptime_topic_is_critical():
    record = {"Sns": {"TopicArn": "arn:aws:sns:us-east-1:1:releaseguard-production-uptime", "Message": '{"AlarmName": "x"}'}}
    assert parse_sns_record(record).severity == "critical"


def test_ignores_messages_that_are_not_alarms():
    assert parse_sns_record({"Sns": {"Message": "plain text"}}) is None
    assert parse_sns_record({"Sns": {"Message": '{"hello": "world"}'}}) is None
    assert parse_sns_record({}) is None


def test_runbook_from_description_wins(load_event):
    alarm = parse_sns_record(load_event("rds_free_storage_critical.json")["Records"][0])
    assert runbook_key_for(alarm) == "db-disk-full"
    assert "Runbook: database disk" in load_runbook("db-disk-full")


def test_runbook_falls_back_to_metric_name():
    record = {
        "Sns": {
            "Message": '{"AlarmName": "a", "Trigger": {"MetricName": "mem_used_percent", "Namespace": "CWAgent", "Dimensions": []}}'
        }
    }
    assert runbook_key_for(parse_sns_record(record)) == "memory-pressure"


def test_runbook_loader_rejects_path_traversal_and_unknown_keys():
    assert load_runbook("../handler") == ""
    assert load_runbook("does-not-exist") == ""
    assert load_runbook(None) == ""
