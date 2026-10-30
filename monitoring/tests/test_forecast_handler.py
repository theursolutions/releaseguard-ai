from datetime import datetime, timedelta, timezone

from storage_forecast import handler


class FakeCloudWatch:
    """Returns 14 days of hourly data: RDS loses 1 GiB/day, the EC2 disk gains 2 points/day."""

    def __init__(self):
        self.published = []

    def get_metric_data(self, MetricDataQueries, StartTime, EndTime, ScanBy):
        stat = MetricDataQueries[0]["MetricStat"]
        name = stat["Metric"]["MetricName"]
        hours = int((EndTime - StartTime).total_seconds() // 3600)
        timestamps = [StartTime + timedelta(hours=h) for h in range(hours)]
        if name == "FreeStorageSpace":
            values = [40 * 1024**3 - (h / 24) * 1024**3 for h in range(hours)]
        else:
            values = [50 + 2 * (h / 24) for h in range(hours)]
        return {"MetricDataResults": [{"Id": "series", "Timestamps": timestamps, "Values": values}]}

    def put_metric_data(self, Namespace, MetricData):
        self.published.append((Namespace, MetricData))


def test_handler_publishes_days_until_full(monkeypatch):
    fake = FakeCloudWatch()
    monkeypatch.setattr(handler.boto3, "client", lambda service: fake)
    monkeypatch.setenv("RDS_INSTANCES", "crm-prod")
    monkeypatch.setenv("EC2_DISKS", "i-0abc:/")

    result = handler.lambda_handler({}, None)["forecasts"]

    assert 25 < result["rds:crm-prod"] < 27  # ~26 GiB left at 1 GiB/day
    assert 10.5 < result["ec2:i-0abc:/"] < 11.5  # ~77.9% used, +2 points/day -> ~11 days
    namespace, data = fake.published[0]
    assert namespace == "ReleaseGuard/Forecast"
    assert {item["Dimensions"][0]["Value"] for item in data} == {"rds:crm-prod", "ec2:i-0abc:/"}


def test_handler_with_nothing_configured_publishes_nothing(monkeypatch):
    fake = FakeCloudWatch()
    monkeypatch.setattr(handler.boto3, "client", lambda service: fake)
    monkeypatch.delenv("RDS_INSTANCES", raising=False)
    monkeypatch.delenv("EC2_DISKS", raising=False)
    assert handler.lambda_handler({}, None) == {"forecasts": {}}
    assert fake.published == []
