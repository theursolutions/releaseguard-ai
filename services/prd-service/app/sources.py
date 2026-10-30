"""Turns a PRD (PDF, Word, Markdown/text or a Confluence page) into Claude content blocks."""

from __future__ import annotations

import base64
import binascii
import html
import io
import re
import zipfile
from urllib.parse import parse_qs, urlparse

import httpx

MAX_TEXT_CHARACTERS = 400_000  # ~100k tokens: keeps one request inside budget
MAX_FILE_BYTES = 20 * 1024 * 1024


class SourceError(ValueError):
    """A problem with the document that the user can fix. The message is safe to show."""


def _decode(data_base64: str) -> bytes:
    try:
        data = base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise SourceError("The uploaded file could not be read.") from error
    if len(data) > MAX_FILE_BYTES:
        raise SourceError("The file is larger than 20 MB.")
    return data


def docx_to_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml = archive.read("word/document.xml").decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError) as error:
        raise SourceError("The Word file could not be opened.") from error

    xml = xml.replace("<w:tab/>", "\t").replace("<w:br/>", "\n").replace("<w:cr/>", "\n")
    xml = re.sub(r"</w:tc>", " | </w:tc>", xml)  # keep table cells apart
    xml = re.sub(r"</w:p>|</w:tr>", "\n", xml)
    text = html.unescape(re.sub(r"<[^>]+>", "", xml))
    return _tidy(text)


def storage_html_to_text(markup: str) -> str:
    markup = re.sub(r"(?i)<(td|th)[^>]*>", " | ", markup)
    markup = re.sub(r"(?i)</(p|div|li|tr|h[1-6])\s*>|<br\s*/?>", "\n", markup)
    markup = re.sub(r"(?i)<li[^>]*>", "- ", markup)
    return _tidy(html.unescape(re.sub(r"<[^>]+>", "", markup)))


def _tidy(text: str) -> str:
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def confluence_page_id(url: str, site_url: str) -> str:
    """Only links on the connected Atlassian site are accepted, so the API token is never sent to
    another host and the service never fetches arbitrary URLs (SSRF)."""
    site_host = (urlparse(site_url).hostname or "").lower()
    parts = urlparse(url)
    if parts.scheme != "https" or (parts.hostname or "").lower() != site_host or not site_host:
        raise SourceError(f"Only Confluence links on {site_host or 'the connected site'} can be analysed.")
    match = re.search(r"/pages/(\d+)", parts.path)
    if match:
        return match.group(1)
    page_ids = parse_qs(parts.query).get("pageId", [])
    if page_ids and page_ids[0].isdigit():
        return page_ids[0]
    raise SourceError("That link does not point to a Confluence page.")


def fetch_confluence_page(url: str, atlassian: dict, client: httpx.Client | None = None) -> tuple[str, str]:
    site_url = (atlassian.get("site_url") or "").rstrip("/")
    if not site_url.endswith(".atlassian.net") or not atlassian.get("email") or not atlassian.get("api_token"):
        raise SourceError("Connect Jira & Confluence in the portal first.")
    page_id = confluence_page_id(url, site_url)

    client = client or httpx.Client(timeout=30)
    response = client.get(
        f"{site_url}/wiki/api/v2/pages/{page_id}",
        params={"body-format": "storage"},
        auth=(atlassian["email"], atlassian["api_token"]),
        headers={"Accept": "application/json"},
    )
    if response.status_code in (401, 403, 404):
        raise SourceError("Confluence page not found, or the connected account cannot see it.")
    if response.status_code >= 400:
        raise SourceError(f"Confluence returned HTTP {response.status_code}.")
    payload = response.json()
    return payload.get("title") or "Confluence page", storage_html_to_text(payload.get("body", {}).get("storage", {}).get("value", ""))


def content_blocks(document: dict, title: str, atlassian: dict | None = None) -> tuple[list[dict], str | None]:
    """Returns the Claude content blocks and, for Confluence, the page title."""
    kind = document.get("kind")

    if kind == "pdf":
        data = _decode(document.get("data_base64", ""))
        return [{
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(data).decode()},
            "title": title,
        }], None

    page_title = None
    if kind == "docx":
        text = docx_to_text(_decode(document.get("data_base64", "")))
    elif kind == "text":
        text = document.get("text") or ""
    elif kind == "confluence":
        page_title, text = fetch_confluence_page(document.get("url", ""), atlassian or {})
    else:
        raise SourceError("Unsupported document type.")

    text = text.strip()
    if not text:
        raise SourceError("The document has no readable text.")
    if len(text) > MAX_TEXT_CHARACTERS:
        raise SourceError("The document is too long for one analysis. Split it by module and analyse each part.")
    return [{"type": "text", "text": f'<prd title="{html.escape(title)}">\n{text}\n</prd>'}], page_title
