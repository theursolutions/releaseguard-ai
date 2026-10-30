"""Performance figures, computed with the CRM's own definitions (see packages/Webkul/Admin/src/Helpers/Reporting):

  won revenue      SUM(closed_price) of completed, published transactions, windowed on updated_at
  lost revenue     the same for cancelled transactions
  commission paid  SUM(agent_net_amount) of paid commissions, windowed on paid_at
  won / lost leads leads whose stage code is won / lost, windowed on updated_at
  sources          the CRM's source_tag buckets: Enquiry, WhatsApp, Chat, Manual, Others
  scope            transactions: agent_id in scope AND (agency_id IS NULL OR the viewer's agency);
                   leads, commissions, enquiries: owner in scope; listings: the agency's or agent's

Two figures the CRM does not define are labelled in the output: conversion (share of the leads
created in the period that are now won) and win rate (won / (won + lost) for closed leads).
Amounts are never converted between currencies; mixed currencies are reported as such.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from .db import Tables, one, placeholders, rows
from .identity import Identity, agency_member_ids

PERIODS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365, "all": None}
CURRENCY_BY_COUNTRY = {"MY": "RM", "PK": "PKR", "SG": "S$", "AE": "AED"}
STAGE_ORDER = ["new", "contacted", "prospect", "negotiating", "won", "lost"]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# The CRM's "Revenue by sources" buckets (Transaction.php). `%%` because queries are parameterised.
SOURCE_BUCKET = (
    "CASE WHEN l.source_tag LIKE '%%\\_enquiry' THEN 'Enquiry' "
    "WHEN l.source_tag LIKE '%%\\_whatsapp' THEN 'WhatsApp' "
    "WHEN l.source_tag LIKE '%%\\_chat' THEN 'Chat' "
    "WHEN l.source_tag = 'agent_manual_entry' THEN 'Manual' ELSE 'Others' END"
)


class ScopeError(RuntimeError):
    """The viewer asked for data outside what they may see."""


@dataclass
class Scope:
    level: str  # global | agency | agent
    label: str
    user_ids: Optional[list[int]] = None  # None = everyone
    agency_id: Optional[int] = None
    agency_name: Optional[str] = None
    focus: dict = field(default_factory=dict)

    def sql(self, column: str) -> tuple[str, list]:
        if self.user_ids is None:
            return "1=1", []
        if not self.user_ids:
            return "1=0", []
        return f"{column} IN ({placeholders(self.user_ids)})", list(self.user_ids)

    def deals(self) -> tuple[str, list]:
        if self.user_ids is None:
            return ("t.agency_id = %s", [self.agency_id]) if self.agency_id else ("1=1", [])
        clause, params = self.sql("t.agent_id")
        if self.agency_id:
            return f"{clause} AND (t.agency_id IS NULL OR t.agency_id = %s)", params + [self.agency_id]
        return f"{clause} AND t.agency_id IS NULL", params


@dataclass
class Window:
    key: str
    start: Optional[datetime]
    end: datetime
    previous_start: Optional[datetime]
    bucket: str  # day | week | month

    def clause(self, column: str, previous: bool = False) -> tuple[str, list]:
        if self.start is None:
            return f"{column} IS NOT NULL", []
        if previous:
            return f"{column} >= %s AND {column} < %s", [self.previous_start, self.start]
        return f"{column} >= %s AND {column} < %s", [self.start, self.end]

    def bucket_sql(self, column: str) -> str:
        if self.bucket == "day":
            return f"DATE_FORMAT({column}, '%%Y-%%m-%%d')"
        if self.bucket == "week":
            return f"DATE_FORMAT(DATE_SUB(DATE({column}), INTERVAL WEEKDAY({column}) DAY), '%%Y-%%m-%%d')"
        return f"DATE_FORMAT({column}, '%%Y-%%m')"


def window(period: str, now: datetime) -> Window:
    days = PERIODS.get(period, 30)
    if days is None:
        return Window("all", None, now + timedelta(seconds=1), None, "month")
    end = now + timedelta(seconds=1)
    start = end - timedelta(days=days)
    bucket = "day" if days <= 31 else "week" if days <= 120 else "month"
    return Window(period if period in PERIODS else "30d", start, end, start - timedelta(days=days), bucket)


def build_scope(connection, tables: Tables, viewer: Optional[Identity], *, agency_id: Optional[int] = None, agent_user_id: Optional[int] = None) -> Scope:
    """`viewer` None = a ReleaseGuard executive (portal admin): everything, like a CRM moderator."""
    if viewer is None or viewer.level == "global":
        scope = Scope("global", "All agencies")
        if agency_id:
            agency = one(connection, "SELECT id, company_name FROM agencies WHERE id = %s AND deleted_at IS NULL", (agency_id,))
            if not agency:
                raise ScopeError("That agency was not found.")
            scope = Scope("agency", agency["company_name"], agency_member_ids(connection, agency["id"]), agency["id"], agency["company_name"])
    elif viewer.level == "agency":
        scope = Scope("agency", viewer.agency_name or "Your agency", agency_member_ids(connection, viewer.agency_id), viewer.agency_id, viewer.agency_name)
    else:
        return Scope("agent", viewer.name, [viewer.crm_user_id], viewer.agency_id, viewer.agency_name)

    if agent_user_id:
        if scope.user_ids is not None and agent_user_id not in scope.user_ids:
            raise ScopeError("That agent is not in your agency.")
        person = one(connection, "SELECT u.id, u.name, u.agency_id, (SELECT a.agent_name FROM agents a WHERE a.created_by = u.id AND a.deleted_at IS NULL ORDER BY a.id DESC LIMIT 1) agent_name FROM users u WHERE u.id = %s", (agent_user_id,))
        if not person:
            raise ScopeError("That agent was not found.")
        name = (person["agent_name"] or "").strip() or person["name"]
        return Scope("agent", name, [person["id"]], scope.agency_id or person["agency_id"], scope.agency_name, {"agent_user_id": person["id"]})
    return scope


def overview(connection, tables: Tables, scope: Scope, period: str, now: Optional[datetime] = None) -> dict:
    now = now or one(connection, "SELECT NOW() AS now")["now"]
    w = window(period, now)
    t = tables

    deals_scope, deals_params = scope.deals()
    leads_scope, leads_params = scope.sql("l.user_id")
    comm_scope, comm_params = scope.sql("c.agent_id")
    base_deals = f"FROM {t.transactions} t WHERE t.deleted_at IS NULL AND t.record_type = 'published' AND {deals_scope}"

    def deal_totals(status: str, previous: bool = False) -> dict:
        clause, params = w.clause("t.updated_at", previous)
        return one(connection, f"SELECT COUNT(*) n, COALESCE(SUM(t.closed_price), 0) total {base_deals} AND t.status = %s AND {clause}", deals_params + [status] + params)

    won, lost = deal_totals("completed"), deal_totals("cancelled")
    won_prev = deal_totals("completed", previous=True) if w.start else None
    lost_prev = deal_totals("cancelled", previous=True) if w.start else None

    def commission_paid(previous: bool = False) -> float:
        clause, params = w.clause("c.paid_at", previous)
        return float(one(connection, f"SELECT COALESCE(SUM(c.agent_net_amount), 0) v FROM {t.commissions} c WHERE c.deleted_at IS NULL AND c.status = 'paid' AND {comm_scope} AND {clause}", comm_params + params)["v"])

    earnings = rows(
        connection,
        f"SELECT c.status, COALESCE(SUM(c.agent_net_amount), 0) v, COUNT(*) n FROM {t.commissions} c WHERE c.deleted_at IS NULL AND {comm_scope} GROUP BY c.status",
        comm_params,
    )
    by_status = {row["status"]: float(row["v"]) for row in earnings}

    def lead_count(previous: bool = False) -> int:
        clause, params = w.clause("l.created_at", previous)
        return int(one(connection, f"SELECT COUNT(*) n FROM {t.leads} l WHERE l.deleted_at IS NULL AND {leads_scope} AND {clause}", leads_params + params)["n"])

    closed_clause, closed_params = w.clause("COALESCE(l.updated_at, l.created_at)")
    closed = {
        row["code"]: row
        for row in rows(
            connection,
            f"SELECT s.code, COUNT(*) n, COALESCE(SUM(l.lead_value), 0) value FROM {t.leads} l JOIN {t.stages} s ON s.id = l.lead_pipeline_stage_id "
            f"WHERE l.deleted_at IS NULL AND s.code IN ('won', 'lost') AND {leads_scope} AND {closed_clause} GROUP BY s.code",
            leads_params + closed_params,
        )
    }

    created_clause, created_params = w.clause("l.created_at")
    funnel_rows = rows(
        connection,
        f"SELECT s.code, MAX(s.name) name, COUNT(*) n FROM {t.leads} l JOIN {t.stages} s ON s.id = l.lead_pipeline_stage_id "
        f"WHERE l.deleted_at IS NULL AND {leads_scope} AND {created_clause} GROUP BY s.code",
        leads_params + created_params,
    )
    funnel = sorted(
        ({"code": r["code"], "stage": r["name"] or r["code"].title(), "count": int(r["n"])} for r in funnel_rows),
        key=lambda r: STAGE_ORDER.index(r["code"]) if r["code"] in STAGE_ORDER else len(STAGE_ORDER),
    )
    leads_total = lead_count()
    leads_won_of_created = next((r["count"] for r in funnel if r["code"] == "won"), 0)
    won_leads = int(closed.get("won", {}).get("n", 0))
    lost_leads = int(closed.get("lost", {}).get("n", 0))

    listing_scope, listing_params = _listing_scope(scope)
    active_listings = int(one(
        connection,
        "SELECT COUNT(*) n FROM vacancies v LEFT JOIN agents ag ON ag.id = v.agent_id "
        f"WHERE v.status = 'published' AND v.published_at IS NOT NULL AND v.deleted_at IS NULL AND {listing_scope}",
        listing_params,
    )["n"])

    enquiry_scope, enquiry_params = scope.sql("i.recipient_id")
    enquiry_clause, enquiry_window = w.clause("i.created_at")
    enquiries = int(one(connection, f"SELECT COUNT(*) n FROM inquiries i WHERE i.deleted_at IS NULL AND {enquiry_scope} AND {enquiry_clause}", enquiry_params + enquiry_window)["n"])

    kpis = {
        "won_revenue": _kpi(won["total"], won_prev and won_prev["total"]),
        "deals_closed": _kpi(won["n"], won_prev and won_prev["n"]),
        "avg_deal": _kpi(float(won["total"]) / won["n"] if won["n"] else 0, (float(won_prev["total"]) / won_prev["n"]) if won_prev and won_prev["n"] else None),
        "lost_revenue": _kpi(lost["total"], lost_prev and lost_prev["total"]),
        "commission_paid": _kpi(commission_paid(), commission_paid(previous=True) if w.start else None),
        "commission_awaiting": _kpi(by_status.get("approved", 0) + by_status.get("pending_review", 0), None),
        "leads": _kpi(leads_total, lead_count(previous=True) if w.start else None),
        "won_leads": _kpi(won_leads, None),
        "lost_leads": _kpi(lost_leads, None),
        "lost_lead_value": _kpi(closed.get("lost", {}).get("value", 0), None),
        "conversion_rate": _kpi(round(100 * leads_won_of_created / leads_total, 1) if leads_total else 0, None),
        "win_rate": _kpi(round(100 * won_leads / (won_leads + lost_leads), 1) if (won_leads + lost_leads) else 0, None),
        "active_listings": _kpi(active_listings, None),
        "enquiries": _kpi(enquiries, None),
    }

    return {
        "scope": {"level": scope.level, "label": scope.label, "agency_id": scope.agency_id, "agency_name": scope.agency_name, **scope.focus},
        "period": {"key": w.key, "from": w.start.isoformat() if w.start else None, "to": now.isoformat(), "bucket": w.bucket},
        "currency": _currency(connection, t, deals_scope, deals_params),
        "kpis": kpis,
        "earnings": {
            "paid": by_status.get("paid", 0),
            "approved": by_status.get("approved", 0),
            "pending_review": by_status.get("pending_review", 0),
            "cancelled": by_status.get("cancelled", 0),
            "monthly": _monthly_paid(connection, t, comm_scope, comm_params),
        },
        "revenue_trend": _revenue_trend(connection, base_deals, deals_params, w),
        "lead_trend": _lead_trend(connection, t, leads_scope, leads_params, w),
        "funnel": funnel,
        "sources": _sources(connection, t, scope, w),
        "heatmap": _heatmap(connection, t, leads_scope, leads_params, w),
        "lost_reasons": _lost_reasons(connection, t, leads_scope, leads_params, w),
        "leaderboard": _leaderboard(connection, t, scope, w) if scope.level != "agent" else [],
        "agencies": _agencies(connection, t, w) if scope.level == "global" else [],
        "directory": _directory(connection, scope),
        "definitions": {
            "conversion_rate": "Share of the leads created in this period that are now won.",
            "win_rate": "Won leads ÷ (won + lost leads) closed in this period.",
            "commission_awaiting": "Approved or pending-review commissions not paid yet (any date).",
        },
    }


# ---------------------------------------------------------------- helpers

def _kpi(value, previous) -> dict:
    value = float(value or 0)
    result = {"value": round(value, 2)}
    if previous is not None:
        previous = float(previous or 0)
        result["previous"] = round(previous, 2)
        result["change_pct"] = round(100 * (value - previous) / previous, 1) if previous else None
    return result


def _listing_scope(scope: Scope) -> tuple[str, list]:
    if scope.level == "global":
        return "1=1", []
    if scope.level == "agency":
        return "(v.agency_id = %s OR ag.agency_id = %s)", [scope.agency_id, scope.agency_id]
    return "ag.created_by = %s", [scope.user_ids[0]]


def _currency(connection, t: Tables, deals_scope: str, params: list) -> dict:
    found = rows(
        connection,
        f"SELECT t.country_code, COUNT(*) n FROM {t.transactions} t WHERE t.deleted_at IS NULL AND t.record_type = 'published' AND {deals_scope} "
        "GROUP BY t.country_code ORDER BY n DESC",
        params,
    )
    codes = [CURRENCY_BY_COUNTRY.get((r["country_code"] or "").upper(), (r["country_code"] or "").upper() or "RM") for r in found]
    unique = list(dict.fromkeys(codes))
    return {"primary": unique[0] if unique else "RM", "mixed": len(unique) > 1, "all": unique}


def _revenue_trend(connection, base_deals: str, params: list, w: Window) -> list[dict]:
    clause, window_params = w.clause("t.updated_at")
    bucket = w.bucket_sql("t.updated_at")
    found = rows(
        connection,
        f"SELECT {bucket} b, t.status, COUNT(*) n, COALESCE(SUM(t.closed_price), 0) total {base_deals} "
        f"AND t.status IN ('completed', 'cancelled') AND {clause} GROUP BY b, t.status ORDER BY b",
        params + window_params,
    )
    series: dict[str, dict] = {}
    for r in found:
        item = series.setdefault(r["b"], {"bucket": r["b"], "won": 0.0, "lost": 0.0, "deals": 0})
        if r["status"] == "completed":
            item["won"], item["deals"] = float(r["total"]), int(r["n"])
        else:
            item["lost"] = float(r["total"])
    return _fill(list(series.values()), w, {"won": 0.0, "lost": 0.0, "deals": 0})


def _lead_trend(connection, t: Tables, scope_sql: str, params: list, w: Window) -> list[dict]:
    created_clause, created_params = w.clause("l.created_at")
    series: dict[str, dict] = {}
    for r in rows(connection, f"SELECT {w.bucket_sql('l.created_at')} b, COUNT(*) n FROM {t.leads} l WHERE l.deleted_at IS NULL AND {scope_sql} AND {created_clause} GROUP BY b", params + created_params):
        series.setdefault(r["b"], {"bucket": r["b"], "created": 0, "won": 0, "lost": 0})["created"] = int(r["n"])
    closed_clause, closed_params = w.clause("COALESCE(l.updated_at, l.created_at)")
    bucket = w.bucket_sql("COALESCE(l.updated_at, l.created_at)")
    for r in rows(
        connection,
        f"SELECT {bucket} b, s.code, COUNT(*) n FROM {t.leads} l JOIN {t.stages} s ON s.id = l.lead_pipeline_stage_id "
        f"WHERE l.deleted_at IS NULL AND s.code IN ('won', 'lost') AND {scope_sql} AND {closed_clause} GROUP BY b, s.code",
        params + closed_params,
    ):
        series.setdefault(r["b"], {"bucket": r["b"], "created": 0, "won": 0, "lost": 0})[r["code"]] = int(r["n"])
    return _fill(sorted(series.values(), key=lambda i: i["bucket"]), w, {"created": 0, "won": 0, "lost": 0})


def _fill(items: list[dict], w: Window, empty: dict) -> list[dict]:
    """Adds empty buckets so charts show quiet days as zero instead of skipping them."""
    if w.start is None or w.bucket == "month":
        return sorted(items, key=lambda i: i["bucket"])
    by_key = {i["bucket"]: i for i in items}
    step = timedelta(days=1 if w.bucket == "day" else 7)
    cursor = w.start.date() if w.bucket == "day" else (w.start.date() - timedelta(days=w.start.weekday()))
    filled = []
    while cursor <= w.end.date():
        key = cursor.isoformat()
        filled.append(by_key.get(key, {"bucket": key, **empty}))
        cursor += step
    return filled


def _sources(connection, t: Tables, scope: Scope, w: Window) -> list[dict]:
    leads_scope, leads_params = scope.sql("l.user_id")
    created_clause, created_params = w.clause("l.created_at")
    buckets = {name: {"source": name, "leads": 0, "won": 0, "revenue": 0.0} for name in ("Enquiry", "WhatsApp", "Chat", "Manual", "Others")}
    for r in rows(
        connection,
        f"SELECT {SOURCE_BUCKET} src, COUNT(*) n, SUM(s.code = 'won') won FROM {t.leads} l LEFT JOIN {t.stages} s ON s.id = l.lead_pipeline_stage_id "
        f"WHERE l.deleted_at IS NULL AND {leads_scope} AND {created_clause} GROUP BY src",
        leads_params + created_params,
    ):
        buckets[r["src"]]["leads"], buckets[r["src"]]["won"] = int(r["n"]), int(r["won"] or 0)
    deals_scope, deals_params = scope.deals()
    deal_clause, deal_params = w.clause("t.updated_at")
    for r in rows(
        connection,
        f"SELECT {SOURCE_BUCKET} src, COALESCE(SUM(t.closed_price), 0) total FROM {t.transactions} t LEFT JOIN {t.leads} l ON l.id = t.lead_id "
        f"WHERE t.deleted_at IS NULL AND t.record_type = 'published' AND t.status = 'completed' AND {deals_scope} AND {deal_clause} GROUP BY src",
        deals_params + deal_params,
    ):
        buckets[r["src"]]["revenue"] = float(r["total"])
    return [b for b in buckets.values() if b["leads"] or b["revenue"]]


def _heatmap(connection, t: Tables, scope_sql: str, params: list, w: Window) -> dict:
    clause, window_params = w.clause("l.created_at")
    cells = [
        [int(r["d"]), int(r["h"]), int(r["n"])]
        for r in rows(connection, f"SELECT WEEKDAY(l.created_at) d, HOUR(l.created_at) h, COUNT(*) n FROM {t.leads} l WHERE l.deleted_at IS NULL AND {scope_sql} AND {clause} GROUP BY d, h", params + window_params)
    ]
    return {"days": WEEKDAYS, "hours": list(range(24)), "cells": cells, "max": max((c[2] for c in cells), default=0)}


def _lost_reasons(connection, t: Tables, scope_sql: str, params: list, w: Window) -> list[dict]:
    clause, window_params = w.clause("COALESCE(l.updated_at, l.created_at)")
    return [
        {"reason": r["reason"], "count": int(r["n"]), "value": float(r["value"])}
        for r in rows(
            connection,
            f"SELECT COALESCE(r.name, NULLIF(TRIM(l.lost_reason), ''), 'Not given') reason, COUNT(*) n, COALESCE(SUM(l.lead_value), 0) value "
            f"FROM {t.leads} l JOIN {t.stages} s ON s.id = l.lead_pipeline_stage_id LEFT JOIN {t.lost_reasons} r ON r.id = l.lead_lost_reason_id "
            f"WHERE l.deleted_at IS NULL AND s.code = 'lost' AND {scope_sql} AND {clause} GROUP BY reason ORDER BY n DESC LIMIT 8",
            params + window_params,
        )
    ]


def _leaderboard(connection, t: Tables, scope: Scope, w: Window, limit: int = 25) -> list[dict]:
    leads_scope, leads_params = scope.sql("l.user_id")
    deals_scope, deals_params = scope.deals()
    comm_scope, comm_params = scope.sql("c.agent_id")
    people: dict[int, dict] = {}

    def person(user_id: int) -> dict:
        return people.setdefault(int(user_id), {"user_id": int(user_id), "leads": 0, "won": 0, "lost": 0, "revenue": 0.0, "deals": 0, "commission": 0.0, "listings": 0})

    created_clause, created_params = w.clause("l.created_at")
    for r in rows(connection, f"SELECT l.user_id u, COUNT(*) n FROM {t.leads} l WHERE l.deleted_at IS NULL AND l.user_id IS NOT NULL AND {leads_scope} AND {created_clause} GROUP BY l.user_id", leads_params + created_params):
        person(r["u"])["leads"] = int(r["n"])
    closed_clause, closed_params = w.clause("COALESCE(l.updated_at, l.created_at)")
    for r in rows(
        connection,
        f"SELECT l.user_id u, s.code, COUNT(*) n FROM {t.leads} l JOIN {t.stages} s ON s.id = l.lead_pipeline_stage_id "
        f"WHERE l.deleted_at IS NULL AND l.user_id IS NOT NULL AND s.code IN ('won', 'lost') AND {leads_scope} AND {closed_clause} GROUP BY l.user_id, s.code",
        leads_params + closed_params,
    ):
        person(r["u"])[r["code"]] = int(r["n"])
    deal_clause, deal_params = w.clause("t.updated_at")
    for r in rows(
        connection,
        f"SELECT t.agent_id u, COUNT(*) n, COALESCE(SUM(t.closed_price), 0) total FROM {t.transactions} t WHERE t.deleted_at IS NULL AND t.record_type = 'published' "
        f"AND t.status = 'completed' AND t.agent_id IS NOT NULL AND {deals_scope} AND {deal_clause} GROUP BY t.agent_id",
        deals_params + deal_params,
    ):
        p = person(r["u"])
        p["deals"], p["revenue"] = int(r["n"]), float(r["total"])
    paid_clause, paid_params = w.clause("c.paid_at")
    for r in rows(
        connection,
        f"SELECT c.agent_id u, COALESCE(SUM(c.agent_net_amount), 0) v FROM {t.commissions} c WHERE c.deleted_at IS NULL AND c.status = 'paid' "
        f"AND c.agent_id IS NOT NULL AND {comm_scope} AND {paid_clause} GROUP BY c.agent_id",
        comm_params + paid_params,
    ):
        person(r["u"])["commission"] = float(r["v"])
    if scope.level == "agency":
        for user_id in scope.user_ids or []:
            person(user_id)  # every member appears, even with no activity yet

    if not people:
        return []
    ranked = sorted(people.values(), key=lambda p: (p["revenue"], p["won"], p["leads"]), reverse=True)[:limit]
    ids = [p["user_id"] for p in ranked]
    names = {
        r["id"]: r
        for r in rows(
            connection,
            "SELECT u.id, u.name, ag.agent_name, ag.id agent_id, COALESCE(ag.agency_id, u.agency_id) agency_id, a.company_name agency "
            "FROM users u LEFT JOIN agents ag ON ag.id = (SELECT MAX(x.id) FROM agents x WHERE x.created_by = u.id AND x.deleted_at IS NULL) "
            f"LEFT JOIN agencies a ON a.id = COALESCE(ag.agency_id, u.agency_id) WHERE u.id IN ({placeholders(ids)})",
            ids,
        )
    }
    listing_counts = {
        r["u"]: int(r["n"])
        for r in rows(
            connection,
            "SELECT ag.created_by u, COUNT(*) n FROM vacancies v JOIN agents ag ON ag.id = v.agent_id "
            f"WHERE v.status = 'published' AND v.published_at IS NOT NULL AND v.deleted_at IS NULL AND ag.created_by IN ({placeholders(ids)}) GROUP BY ag.created_by",
            ids,
        )
    }
    for p in ranked:
        info = names.get(p["user_id"], {})
        p["name"] = ((info.get("agent_name") or "").strip() or info.get("name") or f"User {p['user_id']}")
        p["agency"] = info.get("agency")
        p["listings"] = listing_counts.get(p["user_id"], 0)
        closed = p["won"] + p["lost"]
        p["win_rate"] = round(100 * p["won"] / closed, 1) if closed else None
    return ranked


def _agencies(connection, t: Tables, w: Window, limit: int = 12) -> list[dict]:
    deal_clause, deal_params = w.clause("t.updated_at")
    revenue = {
        r["a"]: r
        for r in rows(
            connection,
            f"SELECT t.agency_id a, COUNT(*) n, COALESCE(SUM(t.closed_price), 0) total FROM {t.transactions} t WHERE t.deleted_at IS NULL AND t.record_type = 'published' "
            f"AND t.status = 'completed' AND t.agency_id IS NOT NULL AND {deal_clause} GROUP BY t.agency_id",
            deal_params,
        )
    }
    created_clause, created_params = w.clause("l.created_at")
    leads = {
        r["a"]: int(r["n"])
        for r in rows(
            connection,
            f"SELECT COALESCE(u.agency_id, own.id) a, COUNT(*) n FROM {t.leads} l JOIN users u ON u.id = l.user_id "
            "LEFT JOIN agencies own ON own.created_by = u.id AND own.deleted_at IS NULL "
            f"WHERE l.deleted_at IS NULL AND {created_clause} GROUP BY a HAVING a IS NOT NULL",
            created_params,
        )
    }
    # Grouped once for all agencies (a per-agency subquery took seconds on 50k+ listings).
    members = {
        r["a"]: int(r["n"])
        for r in rows(
            connection,
            "SELECT x.a, COUNT(DISTINCT x.u) n FROM ("
            "SELECT u.agency_id a, u.id u FROM users u WHERE u.agency_id IS NOT NULL AND u.deleted_at IS NULL "
            "AND EXISTS (SELECT 1 FROM agents g WHERE g.created_by = u.id AND g.deleted_at IS NULL) "
            "UNION ALL SELECT a.id, a.created_by FROM agencies a WHERE a.deleted_at IS NULL) x GROUP BY x.a",
        )
    }
    # A listing counts for an agency through the listing itself or its agent (as the CRM's listings grid does).
    listings = {
        r["a"]: int(r["n"])
        for r in rows(
            connection,
            "SELECT x.a, COUNT(DISTINCT x.id) n FROM ("
            "SELECT v.agency_id a, v.id FROM vacancies v WHERE v.status = 'published' AND v.published_at IS NOT NULL AND v.deleted_at IS NULL AND v.agency_id IS NOT NULL "
            "UNION ALL SELECT ag.agency_id, v.id FROM vacancies v JOIN agents ag ON ag.id = v.agent_id "
            "WHERE v.status = 'published' AND v.published_at IS NOT NULL AND v.deleted_at IS NULL AND ag.agency_id IS NOT NULL) x GROUP BY x.a",
        )
    }
    agencies = rows(connection, "SELECT a.id, a.company_name FROM agencies a WHERE a.deleted_at IS NULL")
    result = [
        {
            "id": a["id"], "name": a["company_name"], "agents": members.get(a["id"], 0), "listings": listings.get(a["id"], 0),
            "revenue": float(revenue.get(a["id"], {}).get("total", 0)), "deals": int(revenue.get(a["id"], {}).get("n", 0)), "leads": leads.get(a["id"], 0),
        }
        for a in agencies
    ]
    return sorted(result, key=lambda a: (a["revenue"], a["leads"]), reverse=True)[:limit]


def _directory(connection, scope: Scope) -> dict:
    """Who the viewer can drill into: agencies (executives) and agents (executives and agency leads)."""
    if scope.level == "global":
        return {"agencies": [{"id": r["id"], "name": r["company_name"]} for r in rows(connection, "SELECT id, company_name FROM agencies WHERE deleted_at IS NULL ORDER BY company_name")]}
    if scope.level == "agency" and scope.user_ids:
        found = rows(
            connection,
            "SELECT u.id, COALESCE(NULLIF(TRIM((SELECT a.agent_name FROM agents a WHERE a.created_by = u.id AND a.deleted_at IS NULL ORDER BY a.id DESC LIMIT 1)), ''), u.name) name "
            f"FROM users u WHERE u.id IN ({placeholders(scope.user_ids)}) ORDER BY name",
            scope.user_ids,
        )
        return {"agents": [{"user_id": r["id"], "name": r["name"]} for r in found]}
    return {}


def _monthly_paid(connection, t: Tables, comm_scope: str, params: list) -> list[dict]:
    return [
        {"month": r["m"], "paid": float(r["v"])}
        for r in rows(
            connection,
            f"SELECT DATE_FORMAT(c.paid_at, '%%Y-%%m') m, COALESCE(SUM(c.agent_net_amount), 0) v FROM {t.commissions} c "
            f"WHERE c.deleted_at IS NULL AND c.status = 'paid' AND c.paid_at IS NOT NULL AND {comm_scope} GROUP BY m ORDER BY m DESC LIMIT 12",
            params,
        )
    ][::-1]
