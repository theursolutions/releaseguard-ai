"""Performance service API. Stateless: the portal sends the read-only CRM database connection and
the viewer with each call; the service resolves what that viewer may see again every time."""

from __future__ import annotations

import logging
from typing import Literal, Optional

import pymysql
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import __version__, demo, identity, metrics
from .db import DatabaseError, connect, one
from .security import require_service_token

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ReleaseGuard performance service", version=__version__)


class CrmDatabase(BaseModel):
    host: str = Field(min_length=1, max_length=255)
    port: Optional[int] = Field(default=3306, ge=1, le=65535)
    database: str = Field(min_length=1, max_length=64)
    username: str = Field(min_length=1, max_length=64)
    password: Optional[str] = Field(default=None, max_length=500)
    table_prefix: Optional[str] = Field(default="crm_", max_length=20)


class Credentials(BaseModel):
    crm_db: Optional[CrmDatabase] = None


class Viewer(BaseModel):
    # executive = a ReleaseGuard admin (sees everything); crm = a person who signed in with their CRM account.
    kind: Literal["executive", "crm"]
    crm_user_id: Optional[int] = None


class VerifyRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=500)
    credentials: Credentials


class OverviewRequest(BaseModel):
    viewer: Viewer
    period: Literal["7d", "30d", "90d", "12m", "all"] = "30d"
    agency_id: Optional[int] = None
    agent_user_id: Optional[int] = None
    credentials: Credentials = Credentials()


class ConnectionTestRequest(BaseModel):
    connection: Literal["crm_db"]
    credentials: Credentials


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "performance-service", "version": __version__}


@app.get("/manifest")
def manifest() -> dict:
    return {
        "name": "performance-service",
        "title": "Performance",
        "version": __version__,
        "description": "Sales, agent and agency performance from the CRM / HomeNet database (read-only), plus sign-in with a CRM account. Demo data until the database is connected.",
        "capabilities": ["performance.overview", "identity.verify", "connections.test.crm_db"],
        "requires": [],
        "optional": ["crm_db"],
    }


@app.post("/v1/identity/verify", dependencies=[Depends(require_service_token)])
def verify(request: VerifyRequest) -> dict:
    database = _database(request.credentials)
    try:
        with connect(database) as (connection, tables):
            person = identity.verify(connection, tables, request.email, request.password)
    except identity.AccessDenied as error:
        status = 401 if str(error) == identity.GENERIC_FAILURE else 403
        raise HTTPException(status, str(error)) from error
    except (DatabaseError, pymysql.MySQLError) as error:
        raise HTTPException(502, _db_message(error)) from error
    return {"identity": person.as_dict()}


@app.post("/v1/performance/overview", dependencies=[Depends(require_service_token)])
def overview(request: OverviewRequest) -> dict:
    if request.credentials.crm_db is None:
        if request.viewer.kind != "executive":
            raise HTTPException(422, "The CRM database is not connected.")
        return _demo(request)

    try:
        with connect(request.credentials.crm_db.model_dump()) as (connection, tables):
            viewer = None
            if request.viewer.kind == "crm":
                if not request.viewer.crm_user_id:
                    raise HTTPException(422, "Missing CRM user.")
                viewer = identity.resolve(connection, tables, request.viewer.crm_user_id)
            scope = metrics.build_scope(connection, tables, viewer, agency_id=request.agency_id, agent_user_id=request.agent_user_id)
            result = metrics.overview(connection, tables, scope, request.period)
    except identity.AccessDenied as error:
        raise HTTPException(403, str(error)) from error
    except metrics.ScopeError as error:
        raise HTTPException(403, str(error)) from error
    except (DatabaseError, pymysql.MySQLError) as error:
        raise HTTPException(502, _db_message(error)) from error
    return {"demo": False, **result}


@app.post("/v1/connections/test", dependencies=[Depends(require_service_token)])
def test_connection(request: ConnectionTestRequest) -> dict:
    if request.credentials.crm_db is None:
        return {"ok": False, "message": "Enter the database host, name, user and password first."}
    try:
        with connect(request.credentials.crm_db.model_dump()) as (connection, tables):
            counts = one(
                connection,
                f"SELECT (SELECT COUNT(*) FROM {tables.leads}) leads, (SELECT COUNT(*) FROM {tables.transactions}) deals, (SELECT COUNT(*) FROM agencies) agencies",
            )
            # Warn when the user can write: ReleaseGuard only needs SELECT.
            grants = " ".join(str(next(iter(row.values()))) for row in _grants(connection)).upper()
    except (DatabaseError, pymysql.MySQLError) as error:
        return {"ok": False, "message": _db_message(error)}

    message = f"Connected to the CRM database: {counts['leads']} leads, {counts['deals']} deals, {counts['agencies']} agencies."
    if any(word in grants for word in ("INSERT", "UPDATE", "DELETE", "ALL PRIVILEGES")):
        message += " Warning: this database user can change data. Use a SELECT-only user."
    return {"ok": True, "message": message}


def _grants(connection) -> list[dict]:
    with connection.cursor() as cursor:
        cursor.execute("SHOW GRANTS")
        return list(cursor.fetchall())


def _database(credentials: Credentials) -> dict:
    if credentials.crm_db is None:
        raise HTTPException(422, "The CRM database is not connected, so CRM accounts cannot sign in yet.")
    return credentials.crm_db.model_dump()


def _db_message(error: Exception) -> str:
    if isinstance(error, DatabaseError):
        return str(error)
    logger.warning("CRM database query failed: %s %s", type(error).__name__, error.args[:1])
    return "The CRM database query failed. Check that the connection user can read the CRM and HomeNet tables."


def _demo(request: OverviewRequest) -> dict:
    agency_index = request.agency_id - 100 if request.agency_id and 100 <= request.agency_id < 100 + len(demo.AGENCIES) else None
    agent_index = request.agent_user_id - 1000 if request.agent_user_id and 1000 <= request.agent_user_id < 1000 + len(demo.AGENTS) else None
    if agent_index is not None:
        return demo.overview(request.period, "agent", agent_index=agent_index)
    if agency_index is not None:
        return demo.overview(request.period, "agency", agency_index=agency_index)
    return demo.overview(request.period)
