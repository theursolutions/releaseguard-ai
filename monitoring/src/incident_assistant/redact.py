"""Removes secrets and personal data from log lines before they leave AWS."""

import re

MAX_LINE_LENGTH = 400

_RULES = [
    (re.compile(r"sk-ant-[A-Za-z0-9_\-]+"), "[REDACTED_API_KEY]"),
    (re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"), "[REDACTED_AWS_KEY]"),
    (re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]+"), "[REDACTED_JWT]"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=\-]+"), "Bearer [REDACTED]"),
    (
        re.compile(r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|client_secret)(\"?'?\s*[:=]\s*\"?'?)[^\s\"',;&]+"),
        r"\1\2[REDACTED]",
    ),
    (re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"), "[EMAIL]"),
    (re.compile(r"\+\d[\d\s\-]{7,16}\d"), "[PHONE]"),
    (re.compile(r"\b\d(?:[ \-]?\d){12,18}\b"), "[NUMBER]"),
    # Keep the network part of IPv4 addresses (useful for diagnosis), hide the host part.
    (re.compile(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b"), r"\1.x"),
]


def redact(text: str) -> str:
    for pattern, replacement in _RULES:
        text = pattern.sub(replacement, text)
    if len(text) > MAX_LINE_LENGTH:
        text = text[:MAX_LINE_LENGTH] + "…"
    return text
