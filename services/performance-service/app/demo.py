"""Clearly labelled demo figures for when no CRM database is connected, in the same shape as the real
ones so every chart can be shown. Seeded by date: stable within a day, different between days."""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from .metrics import PERIODS, STAGE_ORDER, WEEKDAYS, window

AGENCIES = ["Skyline Realty", "Harbour & Co", "Metro Homes"]
AGENTS = [
    ("Aisha Rahman", 0), ("Daniel Lim", 0), ("Farah Aziz", 0), ("Kevin Tan", 0), ("Nur Iman", 0),
    ("Arjun Nair", 1), ("Mei Ling", 1), ("Omar Faisal", 1), ("Sara Wong", 1),
    ("Hafiz Ismail", 2), ("Priya Das", 2), ("Jason Chew", 2), ("Liyana Musa", 2), ("Ravi Kumar", 2),
]


def overview(period: str, level: str = "global", agency_index: int | None = None, agent_index: int | None = None, now: datetime | None = None) -> dict:
    now = now or datetime.now().replace(microsecond=0)
    w = window(period, now)
    rng = random.Random(f"{now.date()}-{period}-{level}-{agency_index}-{agent_index}")
    days = PERIODS.get(w.key) or 540

    if level == "agent":
        members = [agent_index or 0]
    elif level == "agency":
        members = [i for i, (_, a) in enumerate(AGENTS) if a == (agency_index or 0)]
    else:
        members = list(range(len(AGENTS)))
    scale = len(members) / len(AGENTS)

    board = []
    for i in members:
        name, agency = AGENTS[i]
        leads = int(rng.uniform(1.4, 3.6) * days / 7 * (1.3 if i % 5 == 0 else 1))
        won = int(leads * rng.uniform(0.08, 0.22))
        lost = int(leads * rng.uniform(0.15, 0.35))
        deals = max(0, won - rng.randint(0, 2))
        revenue = round(sum(rng.uniform(380_000, 1_450_000) for _ in range(deals)), 2)
        board.append({
            "user_id": 1000 + i, "name": name, "agency": AGENCIES[agency], "leads": leads, "won": won, "lost": lost,
            "revenue": revenue, "deals": deals, "commission": round(revenue * rng.uniform(0.008, 0.014), 2),
            "listings": rng.randint(3, 28), "win_rate": round(100 * won / (won + lost), 1) if won + lost else None,
        })
    board.sort(key=lambda p: (p["revenue"], p["won"]), reverse=True)

    totals = {k: sum(p[k] for p in board) for k in ("leads", "won", "lost", "revenue", "deals", "commission", "listings")}
    lost_revenue = round(totals["revenue"] * rng.uniform(0.12, 0.3), 2)

    def kpi(value, swing=0.25):
        previous = value * rng.uniform(1 - swing, 1 + swing)
        return {"value": round(value, 2), "previous": round(previous, 2), "change_pct": round(100 * (value - previous) / previous, 1) if previous else None}

    buckets = _buckets(w)
    weights = [rng.uniform(0.4, 1.6) * (1.25 if datetime.fromisoformat(b + ("-01" if len(b) == 7 else "")).weekday() < 5 else 0.6) for b in buckets]
    total_weight = sum(weights) or 1
    revenue_trend = [
        {"bucket": b, "won": round(totals["revenue"] * wt / total_weight, 2), "lost": round(lost_revenue * rng.uniform(0.3, 1.7) / len(buckets), 2), "deals": round(totals["deals"] * wt / total_weight)}
        for b, wt in zip(buckets, weights)
    ]
    lead_trend = [
        {"bucket": b, "created": round(totals["leads"] * wt / total_weight), "won": round(totals["won"] * wt / total_weight), "lost": round(totals["lost"] * wt / total_weight)}
        for b, wt in zip(buckets, weights)
    ]

    open_leads = max(0, totals["leads"] - totals["won"] - totals["lost"])
    split = [0.34, 0.27, 0.22, 0.17]
    funnel = [{"code": code, "stage": code.title(), "count": int(open_leads * share)} for code, share in zip(STAGE_ORDER[:4], split)]
    funnel += [{"code": "won", "stage": "Won", "count": totals["won"]}, {"code": "lost", "stage": "Lost", "count": totals["lost"]}]

    source_shares = {"Enquiry": 0.41, "WhatsApp": 0.27, "Chat": 0.14, "Manual": 0.12, "Others": 0.06}
    sources = [
        {"source": s, "leads": int(totals["leads"] * share), "won": int(totals["won"] * share * rng.uniform(0.7, 1.3)), "revenue": round(totals["revenue"] * share * rng.uniform(0.7, 1.3), 2)}
        for s, share in source_shares.items()
    ]

    cells = []
    for d in range(7):
        for h in range(24):
            busy = (1.0 if 9 <= h <= 12 else 0.85 if 19 <= h <= 22 else 0.55 if 13 <= h <= 18 else 0.08) * (1.0 if d < 5 else 0.7)
            count = int(rng.uniform(0.6, 1.4) * busy * totals["leads"] / 70)
            if count:
                cells.append([d, h, count])

    reasons = ["Price too high", "Chose another agent", "Not responsive", "Financing rejected", "Property sold", "Not given"]
    lost_reasons = [{"reason": r, "count": max(1, int(totals["lost"] * s)), "value": round(lost_revenue * s, 2)} for r, s in zip(reasons, (0.29, 0.22, 0.18, 0.13, 0.1, 0.08))]

    agencies = []
    if level == "global":
        for index, name in enumerate(AGENCIES):
            people = [p for p in board if p["agency"] == name]
            agencies.append({"id": 100 + index, "name": name, "agents": len(people), "listings": sum(p["listings"] for p in people), "revenue": sum(p["revenue"] for p in people), "deals": sum(p["deals"] for p in people), "leads": sum(p["leads"] for p in people)})
        agencies.sort(key=lambda a: a["revenue"], reverse=True)

    label = AGENTS[members[0]][0] if level == "agent" else AGENCIES[agency_index or 0] if level == "agency" else "All agencies"
    paid = totals["commission"]
    return {
        "demo": True,
        "note": "The CRM database is not connected: these are simulated demo figures, not real company data.",
        "scope": {"level": level, "label": label, "agency_id": None if level == "global" else 100 + (agency_index or AGENTS[members[0]][1]), "agency_name": None if level == "global" else AGENCIES[agency_index if agency_index is not None else AGENTS[members[0]][1]]},
        "period": {"key": w.key, "from": w.start.isoformat() if w.start else None, "to": now.isoformat(), "bucket": w.bucket},
        "currency": {"primary": "RM", "mixed": False, "all": ["RM"]},
        "kpis": {
            "won_revenue": kpi(totals["revenue"]),
            "deals_closed": kpi(totals["deals"]),
            "avg_deal": kpi(totals["revenue"] / totals["deals"] if totals["deals"] else 0, 0.1),
            "lost_revenue": kpi(lost_revenue),
            "commission_paid": kpi(paid),
            "commission_awaiting": {"value": round(paid * rng.uniform(0.3, 0.7), 2)},
            "leads": kpi(totals["leads"], 0.2),
            "won_leads": {"value": totals["won"]},
            "lost_leads": {"value": totals["lost"]},
            "lost_lead_value": {"value": round(lost_revenue * 1.4, 2)},
            "conversion_rate": {"value": round(100 * totals["won"] / totals["leads"], 1) if totals["leads"] else 0},
            "win_rate": {"value": round(100 * totals["won"] / (totals["won"] + totals["lost"]), 1) if totals["won"] + totals["lost"] else 0},
            "active_listings": {"value": totals["listings"]},
            "enquiries": {"value": int(totals["leads"] * 1.8 * scale + totals["leads"])},
        },
        "earnings": {
            "paid": paid, "approved": round(paid * 0.35, 2), "pending_review": round(paid * 0.2, 2), "cancelled": round(paid * 0.05, 2),
            "monthly": [{"month": (now.replace(day=1) - timedelta(days=30 * k)).strftime("%Y-%m"), "paid": round(paid / 6 * rng.uniform(0.5, 1.5), 2)} for k in range(5, -1, -1)],
        },
        "revenue_trend": revenue_trend,
        "lead_trend": lead_trend,
        "funnel": funnel,
        "sources": sources,
        "heatmap": {"days": WEEKDAYS, "hours": list(range(24)), "cells": cells, "max": max((c[2] for c in cells), default=0)},
        "lost_reasons": lost_reasons,
        "leaderboard": board if level != "agent" else [],
        "agencies": agencies,
        "directory": {"agencies": [{"id": 100 + i, "name": n} for i, n in enumerate(AGENCIES)]} if level == "global" else {"agents": [{"user_id": 1000 + i, "name": AGENTS[i][0]} for i in members]} if level == "agency" else {},
        "definitions": {
            "conversion_rate": "Share of the leads created in this period that are now won.",
            "win_rate": "Won leads ÷ (won + lost leads) closed in this period.",
            "commission_awaiting": "Approved or pending-review commissions not paid yet (any date).",
        },
    }


def _buckets(w) -> list[str]:
    if w.bucket == "month":
        start = w.start or (w.end - timedelta(days=540))
        months, cursor = [], start.replace(day=1)
        while cursor <= w.end:
            months.append(cursor.strftime("%Y-%m"))
            cursor = (cursor + timedelta(days=32)).replace(day=1)
        return months
    step = timedelta(days=1 if w.bucket == "day" else 7)
    cursor = w.start.date() if w.bucket == "day" else w.start.date() - timedelta(days=w.start.weekday())
    keys = []
    while cursor <= w.end.date():
        keys.append(cursor.isoformat())
        cursor += step
    return keys
