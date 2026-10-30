"""Read-only access to the CRM / HomeNet MySQL schema.

CRM tables carry a prefix (default `crm_`); HomeNet tables (users, agents, agencies, vacancies,
inquiries, ...) have none. Every query is parameterised; table names come only from this module.
The session is also put into READ ONLY mode with a statement time limit, on top of the SELECT-only
database user, so a bug here can never change CRM data or hold the database for long.
"""

from __future__ import annotations

import logging
import re
from contextlib import contextmanager
from typing import Any, Iterator

import pymysql
from pymysql.cursors import DictCursor

STATEMENT_TIMEOUT_MS = 15_000
logger = logging.getLogger(__name__)


class DatabaseError(RuntimeError):
    """A problem the admin can fix. The message is safe to show."""


class Tables:
    def __init__(self, prefix: str = "crm_"):
        if not re.fullmatch(r"[A-Za-z0-9_]{0,20}", prefix or ""):
            raise DatabaseError("The CRM table prefix may only contain letters, numbers and underscores.")
        p = prefix or ""
        self.leads = f"{p}leads"
        self.stages = f"{p}lead_pipeline_stages"
        self.lost_reasons = f"{p}lead_lost_reasons"
        self.transactions = f"{p}transactions"
        self.commissions = f"{p}commissions"
        self.roles = f"{p}roles"


@contextmanager
def connect(credentials: dict) -> Iterator[tuple[Any, Tables]]:
    tables = Tables(credentials.get("table_prefix") if credentials.get("table_prefix") is not None else "crm_")
    try:
        connection = pymysql.connect(
            host=credentials["host"],
            port=int(credentials.get("port") or 3306),
            user=credentials["username"],
            password=credentials.get("password") or "",
            database=credentials["database"],
            charset="utf8mb4",
            cursorclass=DictCursor,
            connect_timeout=8,
            read_timeout=30,
            autocommit=True,
        )
    except pymysql.err.OperationalError as error:
        code = error.args[0] if error.args else None
        if code == 1045:
            raise DatabaseError("The CRM database rejected the username or password.") from error
        if code == 1049:
            raise DatabaseError("The CRM database name was not found on that server.") from error
        raise DatabaseError("Could not reach the CRM database. Check the host and port.") from error
    except (KeyError, ValueError) as error:
        raise DatabaseError("The CRM database connection is incomplete.") from error

    try:
        with connection.cursor() as cursor:
            cursor.execute("SET SESSION TRANSACTION READ ONLY")
            cursor.execute(f"SET SESSION MAX_EXECUTION_TIME = {STATEMENT_TIMEOUT_MS}")
        yield connection, tables
    finally:
        connection.close()


def rows(connection, sql: str, params: tuple | list = ()) -> list[dict]:
    with connection.cursor() as cursor:
        try:
            cursor.execute(sql, params)
        except pymysql.MySQLError as error:
            # The statement (never its parameters) tells an operator which query to tune.
            logger.warning("CRM query failed (%s): %s", error.args[:1], " ".join(sql.split())[:120])
            raise
        return list(cursor.fetchall())


def one(connection, sql: str, params: tuple | list = ()) -> dict | None:
    result = rows(connection, sql, params)
    return result[0] if result else None


def placeholders(values: list) -> str:
    return ", ".join(["%s"] * len(values))
