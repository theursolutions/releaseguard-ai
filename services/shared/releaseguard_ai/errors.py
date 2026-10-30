"""One error type for every provider, with a code the portal understands and a message users can read."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Codes: not_configured, auth_required, permission, no_credit, model_not_found, rate_limited, timeout,
# unreachable, bad_request, unavailable, refused, truncated, invalid_output, unsupported, provider_error
AUTH_CODES = {"not_configured", "auth_required", "permission"}


class AIError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def translate(error: BaseException, label: str) -> AIError:
    """Maps any SDK error (Anthropic, OpenAI, Google) to an AIError. Raw details stay in the logs."""
    if isinstance(error, AIError):
        return error

    # Anthropic/OpenAI SDK errors carry `status_code`; Google GenAI errors carry an int `code`.
    status = getattr(error, "status_code", None)
    if not isinstance(status, int):
        status = getattr(error, "code", None) if isinstance(getattr(error, "code", None), int) else None
    name = type(error).__name__
    logger.warning("%s request failed: %s (HTTP %s)", label, name, status)
    if status in (400, 404, 422):
        # The provider's explanation of a rejected request (it names the bad parameter, never a key).
        logger.warning("%s said: %s", label, str(error)[:400])

    text = str(error).lower()
    if any(phrase in text for phrase in ("credit balance is too low", "insufficient_quota", "exceeded your current quota")):
        return AIError("no_credit", f"{label} has no API credit left. An admin must add credit to the {label} account (billing page) or switch to another provider on the Connections page.")
    if "Timeout" in name or status == 408:
        return AIError("timeout", f"{label} took too long to respond. Please try again.")
    if status == 400 and "api key" in str(error).lower():
        # Gemini reports an invalid key as HTTP 400 rather than 401.
        return AIError("auth_required", f"{label} rejected the API key. An admin must check the {label} connection.")
    if status == 401:
        return AIError("auth_required", f"{label} rejected the API key. An admin must check the {label} connection.")
    if status == 403:
        return AIError("permission", f"These credentials are not allowed to use this {label} model.")
    if status == 404:
        return AIError("model_not_found", f"The configured {label} model was not found. Check the model name on the Connections page.")
    if status == 429:
        return AIError("rate_limited", f"{label} is rate-limited or the usage limit was reached. Try again shortly.")
    if status in (400, 413, 422):
        return AIError("bad_request", f"{label} could not process this request.")
    if isinstance(status, int) and status >= 500:
        return AIError("unavailable", f"{label} is temporarily unavailable. Please try again in a few minutes.")
    if "Connect" in name or "Connection" in name:
        return AIError("unreachable", f"Could not reach {label} from the server.")
    return AIError("provider_error", f"Something went wrong while contacting {label}.")
