"""Who a CRM user is and what they may see, following the CRM's own rules.

Mirrors `User::getRoleIdAttribute()` and HomeNet's login checks (first match wins):
  1. moderator_users row                      -> moderator      (everything)
  2. owns a live agency (agencies.created_by) -> agency_owner   (their agency's agents)
  3. agent_roles row: an agency-wide role     -> agency_admin   (their agency's agents)
                      any other role          -> agent          (their own records)
  4. users.agency_id set                      -> agent (staff), or independent if the live agents
                                                 row has left the agency
  5. a live agents row                        -> independent    (their own records)
Anyone else has no CRM role and cannot sign in. Inactive, deleted or unpublished-agency users are
refused, as HomeNet does. The scope is resolved again on every request, so a deactivated agent or
a changed role takes effect immediately.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional

import bcrypt

from .db import Tables, one, rows

GENERIC_FAILURE = "These credentials do not match our records."


class AccessDenied(RuntimeError):
    """The person is known but may not use ReleaseGuard. The message is safe to show."""


@dataclass
class Identity:
    crm_user_id: int
    name: str
    email: str
    persona: str  # moderator | agency_owner | agency_admin | agent | independent
    level: str  # global | agency | agent
    agency_id: Optional[int] = None
    agency_name: Optional[str] = None

    def as_dict(self) -> dict:
        return asdict(self)


def password_matches(password: str, stored_hash: Optional[str]) -> bool:
    if not stored_hash or not password:
        return False
    # PHP writes bcrypt as $2y$; it is the same algorithm as $2b$.
    normalised = ("$2b$" + stored_hash[4:]) if stored_hash.startswith("$2y$") else stored_hash
    try:
        return bcrypt.checkpw(password.encode(), normalised.encode())
    except ValueError:
        return False  # not a bcrypt hash (e.g. a social-login account)


def verify(connection, tables: Tables, email: str, password: str) -> Identity:
    """Checks an email + password against the CRM users table. Raises AccessDenied."""
    candidates = rows(
        connection,
        "SELECT id, password FROM users WHERE email = %s AND deleted_at IS NULL ORDER BY id",
        (email.strip(),),
    )
    for candidate in candidates:
        if password_matches(password, candidate["password"]):
            return resolve(connection, tables, candidate["id"])
    raise AccessDenied(GENERIC_FAILURE)


def resolve(connection, tables: Tables, user_id: int) -> Identity:
    user = one(
        connection,
        "SELECT id, name, email, active, agency_id FROM users WHERE id = %s AND deleted_at IS NULL",
        (user_id,),
    )
    if not user:
        raise AccessDenied("This CRM account no longer exists.")
    if int(user["active"] or 0) != 1:
        raise AccessDenied("This CRM account is not active.")

    agent = one(
        connection,
        "SELECT id, agency_id, status, agent_name FROM agents WHERE created_by = %s AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
        (user_id,),
    )
    name = ((agent or {}).get("agent_name") or "").strip() or user["name"] or user["email"]
    base = {"crm_user_id": user["id"], "name": name, "email": user["email"]}

    if one(connection, "SELECT user_id FROM moderator_users WHERE user_id = %s", (user_id,)):
        return Identity(**base, persona="moderator", level="global")

    if agent and agent["status"] != "active":
        raise AccessDenied("Your agent account is not active.")

    owned = one(
        connection,
        "SELECT id, company_name, published_at FROM agencies WHERE created_by = %s AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
        (user_id,),
    )
    if owned:
        _require_published(owned)
        return Identity(**base, persona="agency_owner", level="agency", agency_id=owned["id"], agency_name=owned["company_name"])

    agency_id = (agent or {}).get("agency_id") or user["agency_id"]
    role = one(
        connection,
        f"SELECT r.name, r.permission_type, r.agency_id FROM agent_roles ar JOIN {tables.roles} r ON r.id = ar.role_id "
        "WHERE ar.agent_id = %s ORDER BY ar.id DESC LIMIT 1",
        (user_id,),
    )
    if role and agency_id:
        agency = _agency(connection, agency_id)
        agency_wide = role["permission_type"] in ("all", "agency") or (role["name"] == "Administrator" and role["agency_id"] is None)
        if agency_wide:
            return Identity(**base, persona="agency_admin", level="agency", agency_id=agency["id"], agency_name=agency["company_name"])
        return Identity(**base, persona="agent", level="agent", agency_id=agency["id"], agency_name=agency["company_name"])

    if user["agency_id"]:
        if agent and agent["agency_id"] is None:
            return Identity(**base, persona="independent", level="agent")
        agency = _agency(connection, user["agency_id"])
        return Identity(**base, persona="agent", level="agent", agency_id=agency["id"], agency_name=agency["company_name"])

    if agent:
        return Identity(**base, persona="independent", level="agent")

    raise AccessDenied("This account has no CRM role, so it cannot use ReleaseGuard.")


def agency_member_ids(connection, agency_id: int) -> list[int]:
    """Current members, as the CRM counts them: users in the agency with a live agents row, plus the owner."""
    members = rows(
        connection,
        "SELECT u.id FROM users u WHERE u.agency_id = %s AND u.deleted_at IS NULL "
        "AND EXISTS (SELECT 1 FROM agents a WHERE a.created_by = u.id AND a.deleted_at IS NULL)",
        (agency_id,),
    )
    owner = one(connection, "SELECT created_by FROM agencies WHERE id = %s", (agency_id,))
    ids = {row["id"] for row in members}
    if owner and owner["created_by"]:
        ids.add(owner["created_by"])
    return sorted(ids)


def _agency(connection, agency_id: int) -> dict:
    agency = one(connection, "SELECT id, company_name, published_at FROM agencies WHERE id = %s AND deleted_at IS NULL", (agency_id,))
    if not agency:
        raise AccessDenied("Your agency is no longer active.")
    _require_published(agency)
    return agency


def _require_published(agency: dict) -> None:
    if agency.get("published_at") is None:
        raise AccessDenied("Your agency is not published yet, so it cannot sign in.")
