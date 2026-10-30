import os
from datetime import datetime
from pathlib import Path

import bcrypt
import pytest
from fastapi.testclient import TestClient

from app import demo, identity, main, metrics
from app.db import DatabaseError, Tables
from app.main import app

TOKEN = "test-service-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
client = TestClient(app)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)


# ---------------------------------------------------------------- API surface

def test_health_is_public_and_everything_else_needs_the_token():
    assert client.get("/health").json()["service"] == "performance-service"
    body = {"viewer": {"kind": "executive"}, "period": "30d"}
    assert client.post("/v1/performance/overview", json=body).status_code == 401
    assert client.post("/v1/performance/overview", json=body, headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_without_a_database_executives_get_labelled_demo_data():
    data = client.post("/v1/performance/overview", json={"viewer": {"kind": "executive"}, "period": "30d"}, headers=AUTH).json()
    assert data["demo"] is True and "not real company data" in data["note"]
    for key in ("kpis", "revenue_trend", "lead_trend", "funnel", "sources", "heatmap", "lost_reasons", "leaderboard", "agencies", "earnings"):
        assert key in data
    assert len(data["revenue_trend"]) >= 30 and data["agencies"]


def test_demo_drill_down_by_agency_and_agent():
    agency = client.post("/v1/performance/overview", json={"viewer": {"kind": "executive"}, "agency_id": 101}, headers=AUTH).json()
    assert agency["scope"]["level"] == "agency" and agency["scope"]["label"] == "Harbour & Co"
    assert {p["agency"] for p in agency["leaderboard"]} == {"Harbour & Co"}
    agent = client.post("/v1/performance/overview", json={"viewer": {"kind": "executive"}, "agent_user_id": 1005}, headers=AUTH).json()
    assert agent["scope"] == {**agent["scope"], "level": "agent", "label": "Arjun Nair"} and agent["leaderboard"] == []


def test_crm_viewers_never_get_demo_data():
    response = client.post("/v1/performance/overview", json={"viewer": {"kind": "crm", "crm_user_id": 5}}, headers=AUTH)
    assert response.status_code == 422


def test_sign_in_needs_the_database():
    response = client.post("/v1/identity/verify", json={"email": "a@b.com", "password": "x", "credentials": {}}, headers=AUTH)
    assert response.status_code == 422 and "not connected" in response.json()["detail"]


def test_database_problems_become_readable_messages(monkeypatch):
    def broken(credentials):
        raise DatabaseError("The CRM database rejected the username or password.")

    monkeypatch.setattr(main, "connect", broken)
    credentials = {"crm_db": {"host": "db", "database": "homenet", "username": "ro", "password": "x"}}
    body = client.post("/v1/connections/test", json={"connection": "crm_db", "credentials": credentials}, headers=AUTH).json()
    assert body == {"ok": False, "message": "The CRM database rejected the username or password."}


def test_table_prefix_is_validated():
    with pytest.raises(DatabaseError):
        Tables("crm_; DROP TABLE users")
    assert Tables("").leads == "leads" and Tables().transactions == "crm_transactions"


# ---------------------------------------------------------------- identity rules (fake database)

class FakeDb:
    """Answers identity queries from in-memory tables, matched on the start of each SQL statement."""

    def __init__(self, users=(), agents=(), agencies=(), moderators=(), roles=()):
        self.users, self.agents, self.agencies, self.moderators, self.roles = list(users), list(agents), list(agencies), set(moderators), list(roles)


@pytest.fixture
def fake(monkeypatch):
    db = FakeDb()

    def rows(connection, sql, params=()):
        if sql.startswith("SELECT id, password FROM users"):
            return [{"id": u["id"], "password": u["password"]} for u in db.users if u["email"] == params[0]]
        if sql.startswith("SELECT id, name, email, active, agency_id FROM users"):
            return [u for u in db.users if u["id"] == params[0]]
        if sql.startswith("SELECT id, agency_id, status, agent_name FROM agents"):
            return sorted([a for a in db.agents if a["created_by"] == params[0]], key=lambda a: -a["id"])[:1]
        if sql.startswith("SELECT user_id FROM moderator_users"):
            return [{"user_id": params[0]}] if params[0] in db.moderators else []
        if "FROM agencies WHERE created_by" in sql:
            return [a for a in db.agencies if a["created_by"] == params[0]]
        if "FROM agent_roles" in sql:
            return [r for r in db.roles if r["user_id"] == params[0]]
        if "FROM agencies WHERE id" in sql:
            return [a for a in db.agencies if a["id"] == params[0]]
        raise AssertionError(sql)

    monkeypatch.setattr(identity, "rows", rows)
    monkeypatch.setattr(identity, "one", lambda c, sql, params=(): (rows(c, sql, params) or [None])[0])
    return db


def php_hash(password):
    return "$2y$" + bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()[4:]


def user(uid, email="a@x.com", password="secret", active=1, agency_id=None, name="Person"):
    return {"id": uid, "email": email, "password": php_hash(password) if password else None, "active": active, "agency_id": agency_id, "name": name}


AGENCY = {"id": 7, "company_name": "Skyline", "created_by": 10, "published_at": datetime(2026, 1, 1)}


def test_php_bcrypt_hashes_are_accepted_and_wrong_passwords_are_generic(fake):
    fake.users.append(user(1, password="right"))
    fake.moderators.add(1)
    assert identity.verify(None, Tables(), "a@x.com", "right").persona == "moderator"
    with pytest.raises(identity.AccessDenied) as error:
        identity.verify(None, Tables(), "a@x.com", "wrong")
    assert str(error.value) == identity.GENERIC_FAILURE
    with pytest.raises(identity.AccessDenied) as error:
        identity.verify(None, Tables(), "nobody@x.com", "right")
    assert str(error.value) == identity.GENERIC_FAILURE  # unknown email: same message
    assert identity.password_matches("x", None) is False and identity.password_matches("x", "not-a-hash") is False


def test_persona_rules_follow_the_crm(fake):
    fake.agencies.append(AGENCY)
    fake.users += [user(10), user(11, agency_id=7), user(12, agency_id=7), user(13), user(14, agency_id=7), user(15)]
    fake.agents += [
        {"id": 1, "created_by": 10, "agency_id": 7, "status": "active", "agent_name": "Owner Name"},
        {"id": 2, "created_by": 11, "agency_id": 7, "status": "active", "agent_name": ""},
        {"id": 3, "created_by": 12, "agency_id": 7, "status": "active", "agent_name": "Staff"},
        {"id": 4, "created_by": 13, "agency_id": None, "status": "active", "agent_name": "Solo"},
        {"id": 5, "created_by": 14, "agency_id": None, "status": "active", "agent_name": "Left"},
    ]
    fake.roles.append({"user_id": 11, "name": "Team Lead", "permission_type": "agency", "agency_id": 7})
    fake.roles.append({"user_id": 12, "name": "Sales", "permission_type": "custom", "agency_id": 7})

    owner = identity.resolve(None, Tables(), 10)
    assert (owner.persona, owner.level, owner.agency_id, owner.name) == ("agency_owner", "agency", 7, "Owner Name")
    assert identity.resolve(None, Tables(), 11).persona == "agency_admin"
    staff = identity.resolve(None, Tables(), 12)
    assert (staff.persona, staff.level, staff.agency_id) == ("agent", "agent", 7)
    assert identity.resolve(None, Tables(), 13).persona == "independent"
    assert identity.resolve(None, Tables(), 14).persona == "independent"  # deactivated from the agency
    with pytest.raises(identity.AccessDenied, match="no CRM role"):
        identity.resolve(None, Tables(), 15)


def test_inactive_people_and_unpublished_agencies_are_refused(fake):
    fake.users += [user(20, active=0), user(21), user(22)]
    fake.agents += [{"id": 9, "created_by": 21, "agency_id": None, "status": "inactive", "agent_name": ""}]
    fake.agencies.append({**AGENCY, "id": 8, "created_by": 22, "published_at": None})
    with pytest.raises(identity.AccessDenied, match="not active"):
        identity.resolve(None, Tables(), 20)
    with pytest.raises(identity.AccessDenied, match="agent account is not active"):
        identity.resolve(None, Tables(), 21)
    with pytest.raises(identity.AccessDenied, match="not published"):
        identity.resolve(None, Tables(), 22)


# ---------------------------------------------------------------- scope and window helpers

def test_deal_scope_matches_the_crm_current_agency_rule():
    assert metrics.Scope("global", "All").deals() == ("1=1", [])
    clause, params = metrics.Scope("agency", "A", [1, 2], 7).deals()
    assert clause == "t.agent_id IN (%s, %s) AND (t.agency_id IS NULL OR t.agency_id = %s)" and params == [1, 2, 7]
    assert metrics.Scope("agent", "Solo", [3]).deals() == ("t.agent_id IN (%s) AND t.agency_id IS NULL", [3])
    assert metrics.Scope("agency", "Empty", [], 9).sql("l.user_id") == ("1=0", [])


def test_windows_pick_sensible_buckets():
    now = datetime(2026, 10, 25, 12, 0)
    assert metrics.window("7d", now).bucket == "day"
    assert metrics.window("90d", now).bucket == "week"
    assert metrics.window("12m", now).bucket == "month"
    everything = metrics.window("all", now)
    assert everything.start is None and everything.clause("l.created_at") == ("l.created_at IS NOT NULL", [])


def test_demo_figures_are_internally_consistent():
    data = demo.overview("30d", now=datetime(2026, 10, 25, 9, 0))
    board = data["leaderboard"]
    assert round(sum(p["revenue"] for p in board), 2) == data["kpis"]["won_revenue"]["value"]
    assert sum(p["leads"] for p in board) == data["kpis"]["leads"]["value"]
    assert all(0 <= cell[0] < 7 and 0 <= cell[1] < 24 for cell in data["heatmap"]["cells"])


# ---------------------------------------------------------------- read-only integration (opt-in)

LIVE = os.environ.get("RG_TEST_CRM_DB_PASSWORD_FILE")


@pytest.mark.skipif(not LIVE, reason="set RG_TEST_CRM_DB_PASSWORD_FILE to run against a real CRM database (read-only)")
def test_live_database_overview_and_scopes():
    from app.db import connect, rows

    credentials = {
        "host": os.environ.get("RG_TEST_CRM_DB_HOST", "127.0.0.1"), "port": 3306, "database": os.environ.get("RG_TEST_CRM_DB_NAME", "homenet"),
        "username": os.environ.get("RG_TEST_CRM_DB_USER", "releaseguard_ro"), "password": Path(LIVE).read_text().strip(), "table_prefix": "crm_",
    }
    with connect(credentials) as (connection, tables):
        everything = metrics.overview(connection, tables, metrics.build_scope(connection, tables, None), "all")
        owner_id = rows(connection, "SELECT created_by FROM agencies WHERE deleted_at IS NULL AND published_at IS NOT NULL LIMIT 1")[0]["created_by"]
        owner = identity.resolve(connection, tables, owner_id)
        agency = metrics.overview(connection, tables, metrics.build_scope(connection, tables, owner), "all")

    assert everything["kpis"]["leads"]["value"] >= agency["kpis"]["leads"]["value"]
    assert agency["scope"]["level"] == "agency" and agency["agencies"] == []
    assert {p["user_id"] for p in agency["leaderboard"]} <= set(p["user_id"] for p in agency["directory"]["agents"])
