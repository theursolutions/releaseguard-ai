"""Service-to-service authentication. Only the ReleaseGuard portal holds the token."""

import hmac
import os

from fastapi import Header, HTTPException, status


def require_service_token(authorization: str = Header(default="")) -> None:
    expected = os.environ.get("SERVICE_TOKEN", "")
    if not expected:
        # Refuse to run open: a missing token is a deployment mistake, not "no auth".
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "SERVICE_TOKEN is not configured")
    provided = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid service token")
