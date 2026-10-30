import base64
import io
import json
import zipfile
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from releaseguard_ai.anthropic_provider import AnthropicProvider

from app import analyzer, scoring, sources
from app.main import app

TOKEN = "test-service-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
CREDENTIALS = {"llm": {"provider": "anthropic", "auth_method": "api_key", "api_key": "sk-ant-test-1234567890", "model": None}}

REVIEW = {
    "summary": "Covers agent invitations.",
    "actors": [{"name": "Agency owner", "description": "Invites agents", "permissions": ["invite"]}],
    "flows": [],
    "dependencies": [],
    "questions": [{"flow_id": "General", "question": "Who can revoke?", "why_it_matters": "Security", "blocking": True}],
    "contradictions": [],
    "out_of_scope": [],
    "area_scores": [
        {"area": "acceptance_criteria", "points": 20, "reason": "Most flows"},
        {"area": "edge_cases", "points": 30, "reason": "Over max, must clamp to 20"},
        {"area": "unknown_area", "points": 99, "reason": "ignored"},
    ],
    "diagrams": [],
}


class FakeClaude:
    def __init__(self, stop_reason="end_turn", text=json.dumps(REVIEW)):
        self.calls = []
        response = SimpleNamespace(
            stop_reason=stop_reason,
            content=[SimpleNamespace(type="text", text=text)],
            model="claude-opus-5-5",
            usage=SimpleNamespace(input_tokens=1200, output_tokens=900),
        )
        create = lambda **kw: (self.calls.append(kw), response)[1]
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=create))
        self.messages = SimpleNamespace(create=create)


@pytest.fixture(autouse=True)
def service_token(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)


def install(monkeypatch, fake):
    # The real provider (credential checks, request building) runs; only the SDK client is faked.
    monkeypatch.setattr(AnthropicProvider, "client", lambda self, async_client=False: fake)
    return fake


@pytest.fixture
def fake_claude(monkeypatch):
    return install(monkeypatch, FakeClaude())


client = TestClient(app)


def _docx(paragraphs):
    body = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in paragraphs)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", f'<w:document xmlns:w="x"><w:body>{body}</w:body></w:document>')
    return base64.b64encode(buffer.getvalue()).decode()


def test_health_and_manifest_are_public():
    assert client.get("/health").json()["status"] == "ok"
    manifest = client.get("/manifest").json()
    assert manifest["requires"] == ["ai"]
    assert "prd.analyse" in manifest["capabilities"]


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}])
def test_analyse_requires_the_service_token(headers):
    response = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "x"}, "credentials": CREDENTIALS}, headers=headers)
    assert response.status_code == 401


def test_refuses_to_run_without_a_configured_token(monkeypatch):
    monkeypatch.delenv("SERVICE_TOKEN")
    response = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "x"}, "credentials": CREDENTIALS}, headers=AUTH)
    assert response.status_code == 503


def test_text_prd_is_analysed_and_scored(fake_claude):
    response = client.post(
        "/v1/analyses",
        json={"title": "Agent invites", "document": {"kind": "text", "text": "Owners can invite agents."}, "credentials": CREDENTIALS},
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["score"] == 40  # 20 + clamped 20 + 0 for the rest
    assert body["ready"] is False
    assert "area_scores" not in body["result"]
    assert [a["area"] for a in body["result"]["score_breakdown"]] == list(scoring.AREAS)
    assert body["usage"] == {"input_tokens": 1200, "output_tokens": 900}

    request = fake_claude.calls[0]
    assert request["model"] == "claude-opus-5-5"
    assert request["fallbacks"] == "default"
    assert request["betas"] == ["server-side-fallback-2026-07-01"]
    assert request["output_config"]["format"]["schema"] == analyzer.SCHEMA
    assert "Owners can invite agents." in request["messages"][0]["content"][0]["text"]


def test_pdf_is_sent_as_a_document_block(fake_claude):
    pdf = base64.b64encode(b"%PDF-1.4 fake").decode()
    client.post("/v1/analyses", json={"title": "Spec", "document": {"kind": "pdf", "data_base64": pdf}, "credentials": CREDENTIALS}, headers=AUTH)
    block = fake_claude.calls[0]["messages"][0]["content"][0]
    assert block["type"] == "document"
    assert block["source"]["media_type"] == "application/pdf"


def test_docx_text_is_extracted(fake_claude):
    client.post(
        "/v1/analyses",
        json={"title": "Spec", "document": {"kind": "docx", "data_base64": _docx(["Admin approves listings", "Agent edits drafts"])}, "credentials": CREDENTIALS},
        headers=AUTH,
    )
    text = fake_claude.calls[0]["messages"][0]["content"][0]["text"]
    assert "Admin approves listings" in text and "Agent edits drafts" in text


@pytest.mark.parametrize(
    "document, message",
    [
        ({"kind": "text", "text": "   "}, "no readable text"),
        ({"kind": "docx", "data_base64": base64.b64encode(b"not a zip").decode()}, "could not be opened"),
        ({"kind": "pdf", "data_base64": "%%%not-base64%%%"}, "could not be read"),
        ({"kind": "confluence", "url": "https://atmycondo.atlassian.net/wiki/pages/1"}, "Connect Jira"),
    ],
)
def test_bad_documents_return_a_readable_error(fake_claude, document, message):
    response = client.post("/v1/analyses", json={"title": "t", "document": document, "credentials": CREDENTIALS}, headers=AUTH)
    assert response.status_code == 422
    assert message in response.json()["detail"]
    assert fake_claude.calls == []


def test_confluence_links_must_be_on_the_connected_site():
    assert sources.confluence_page_id("https://acme.atlassian.net/wiki/spaces/PRD/pages/12345/Invites", "https://acme.atlassian.net") == "12345"
    assert sources.confluence_page_id("https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=777", "https://acme.atlassian.net") == "777"
    for url in ("https://evil.example.com/wiki/pages/1", "http://acme.atlassian.net/wiki/pages/1", "https://acme.atlassian.net.evil.com/pages/1"):
        with pytest.raises(sources.SourceError):
            sources.confluence_page_id(url, "https://acme.atlassian.net")


def test_confluence_page_is_fetched_with_the_connected_account():
    class FakeHttp:
        def get(self, url, params, auth, headers):
            self.url, self.auth = url, auth
            return SimpleNamespace(status_code=200, json=lambda: {"title": "Invites PRD", "body": {"storage": {"value": "<h1>Invites</h1><p>Owner invites agents.</p><table><tr><td>A</td><td>B</td></tr></table>"}}})

    http = FakeHttp()
    title, text = sources.fetch_confluence_page(
        "https://acme.atlassian.net/wiki/spaces/PRD/pages/42/Invites", {"site_url": "https://acme.atlassian.net", "email": "bot@acme.com", "api_token": "tok"}, http
    )
    assert http.url == "https://acme.atlassian.net/wiki/api/v2/pages/42"
    assert http.auth == ("bot@acme.com", "tok")
    assert title == "Invites PRD"
    assert "Owner invites agents." in text and "| A" in text


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
def test_unusable_claude_answers_return_422(monkeypatch, stop_reason):
    install(monkeypatch, FakeClaude(stop_reason=stop_reason))
    response = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "x"}, "credentials": CREDENTIALS}, headers=AUTH)
    assert response.status_code == 422


def test_missing_ai_credentials_are_rejected():
    response = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "x"}, "credentials": {}}, headers=AUTH)
    assert response.status_code == 422
    assert "No AI provider is connected" in response.json()["detail"]


def test_bedrock_requests_skip_the_claude_api_only_fallback(monkeypatch):
    fake = install(monkeypatch, FakeClaude())
    credentials = {"llm": {"provider": "anthropic", "auth_method": "bedrock", "bedrock_region": "ap-southeast-1"}}
    body = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "Owners invite agents."}, "credentials": credentials}, headers=AUTH).json()
    assert body["provider"] == "anthropic"
    request = fake.calls[0]
    assert request["model"] == "anthropic.claude-opus-5-5"
    assert "fallbacks" not in request and "betas" not in request


def test_bedrock_needs_a_region():
    credentials = {"llm": {"provider": "anthropic", "auth_method": "bedrock"}}
    response = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "x"}, "credentials": credentials}, headers=AUTH)
    assert response.status_code == 422 and "region" in response.json()["detail"]


def test_missing_api_key_is_reported_plainly():
    credentials = {"llm": {"provider": "anthropic", "auth_method": "api_key"}}
    response = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "x"}, "credentials": credentials}, headers=AUTH)
    assert response.status_code == 422 and "API key" in response.json()["detail"]


def test_claude_subscription_tokens_are_not_accepted():
    # Claude.ai / `claude setup-token` credentials are reserved for Claude Code by Anthropic's terms.
    credentials = {"llm": {"provider": "anthropic", "auth_method": "claude_code", "oauth_token": "sk-ant-oat01-x"}}
    response = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "x"}, "credentials": credentials}, headers=AUTH)
    assert response.status_code == 422


def test_connection_test_reports_rejected_credentials(monkeypatch):
    import anthropic, httpx2

    def reject(**kwargs):
        raise anthropic.AuthenticationError("bad key", response=httpx2.Response(401, request=httpx2.Request("GET", "https://api.anthropic.com")), body=None)

    install(monkeypatch, SimpleNamespace(messages=SimpleNamespace(create=reject)))
    body = client.post("/v1/connections/test", json={"connection": "anthropic", "credentials": {"llm": {"provider": "anthropic", "api_key": "sk-ant-bad-1234567890"}}}, headers=AUTH).json()
    assert body == {"ok": False, "message": "Claude rejected the API key. An admin must check the Claude connection."}


def test_connection_test_without_any_ai_provider_says_what_to_do():
    body = client.post("/v1/connections/test", json={"connection": "ai", "credentials": {}}, headers=AUTH).json()
    assert body["ok"] is False and "No AI provider is connected" in body["message"]


def test_prd_analysis_works_with_any_provider(monkeypatch):
    from releaseguard_ai import Structured
    from releaseguard_ai.gemini_provider import GeminiProvider

    seen = {}

    def structured(self, system, parts, schema, *, schema_name, max_tokens):
        seen.update(parts=parts, schema_name=schema_name)
        return Structured(json.loads(json.dumps(REVIEW)), "gemini-3.8-flash", {"input_tokens": 5, "output_tokens": 6})

    monkeypatch.setattr(GeminiProvider, "structured", structured)
    credentials = {"llm": {"provider": "gemini", "api_key": "AIza-test-key-1234567890"}}
    body = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "Owners invite agents."}, "credentials": credentials}, headers=AUTH).json()
    assert body["provider"] == "gemini" and body["model"] == "gemini-3.8-flash" and body["score"] == 40
    assert seen["schema_name"] == "prd_review" and "Owners invite agents." in seen["parts"][0].text


def test_scoring_clamps_and_fills_missing_areas():
    result = scoring.compute([{"area": "out_of_scope", "points": 50, "reason": "x"}, {"area": "edge_cases", "points": "bad"}])
    by_area = {a["area"]: a for a in result["areas"]}
    assert by_area["out_of_scope"]["points"] == 10
    assert by_area["edge_cases"]["points"] == 0
    assert by_area["dependencies"]["reason"] == "Not assessed."
    assert result["total"] == 10


GRAPH = {
    "lanes": ["Agency owner", "System"],
    "nodes": [
        {"id": "s", "lane": "Agency owner", "kind": "start", "label": "Open invites"},
        {"id": "a", "lane": "Agency owner", "kind": "action", "label": "Enter email"},
        {"id": "d", "lane": "System", "kind": "decision", "label": "Email valid?"},
        {"id": "e", "lane": "System", "kind": "end", "label": "Invite sent"},
    ],
    "edges": [{"from": "s", "to": "a", "label": ""}, {"from": "a", "to": "d", "label": ""}, {"from": "d", "to": "e", "label": "Yes"}],
}
FLOW = {
    "id": "FLOW-OWNER-01", "actor": "Agency owner", "name": "Invite an agent", "steps": ["Enter email", "System sends invite"],
    "business_rules": [], "edge_cases": [], "acceptance_criteria": [], "missing": [], "graph": GRAPH,
}


def test_review_schema_asks_for_a_swimlane_graph_per_flow():
    graph = analyzer.SCHEMA["properties"]["flows"]["items"]["properties"]["graph"]
    assert set(graph["required"]) == {"lanes", "nodes", "edges"}
    assert graph["properties"]["nodes"]["items"]["properties"]["kind"]["enum"] == analyzer.NODE_KINDS


def test_review_groups_flows_by_prd_module_and_asks_for_full_flows():
    properties = analyzer.SCHEMA["properties"]
    assert properties["modules"]["items"]["required"] == ["name", "description"]
    assert "module" in properties["flows"]["items"]["required"]
    assert "For each module, write the user flows that cover it" in analyzer.SYSTEM_PROMPT
    assert "every decision with each outcome the document states" in analyzer.SYSTEM_PROMPT


def test_a_review_gets_room_and_time_for_detailed_flows(monkeypatch):
    seen = {}

    class Recording:
        name = "gemini"

        def structured(self, system, parts, schema, *, schema_name, max_tokens):
            from releaseguard_ai import Structured

            seen["max_tokens"] = max_tokens
            return Structured(json.loads(json.dumps(REVIEW)), "gemini-3.8-flash", {})

    def make(credentials, **options):
        seen.update(options)
        return Recording()

    monkeypatch.setattr(analyzer, "make_provider", make)
    analyzer.analyse([{"kind": "text", "text": "x"}], "t", {"provider": "gemini", "api_key": "k"})
    assert seen["max_tokens"] == 64000
    assert seen["timeout"] == 540  # finishes before the portal stops waiting (600 s)


def test_graphs_that_do_not_connect_are_dropped_from_a_review(monkeypatch):
    broken = {**GRAPH, "edges": [{"from": "s", "to": "missing", "label": ""}]}
    review = {**REVIEW, "flows": [FLOW, {**FLOW, "id": "FLOW-OWNER-02", "graph": broken}]}
    install(monkeypatch, FakeClaude(text=json.dumps(review)))
    response = client.post("/v1/analyses", json={"title": "t", "document": {"kind": "text", "text": "x"}, "credentials": CREDENTIALS}, headers=AUTH)
    flows = response.json()["result"]["flows"]
    assert flows[0]["graph"] == GRAPH
    assert flows[1]["graph"] is None


@pytest.mark.parametrize("graph, problem", [
    (None, "no graph"),
    ({"lanes": [], "nodes": [], "edges": []}, "no lanes"),
    ({**GRAPH, "nodes": GRAPH["nodes"] + [GRAPH["nodes"][0]]}, "same id"),
    ({**GRAPH, "nodes": [{**GRAPH["nodes"][0], "lane": "Nobody"}]}, "outside the flow's lanes"),
    ({**GRAPH, "edges": [{"from": "x", "to": "a", "label": ""}]}, "does not exist"),
    ({**GRAPH, "nodes": [{"id": str(i), "lane": "System", "kind": "action", "label": "x"} for i in range(61)]}, "more than 60"),
])
def test_graph_problems_are_explained(graph, problem):
    assert problem in analyzer.graph_problem(graph)
    assert analyzer.graph_problem(GRAPH) is None


def _revise(json_body):
    return client.post("/v1/flows/revise", json=json_body, headers=AUTH)


def test_revise_requires_the_service_token():
    assert client.post("/v1/flows/revise", json={}).status_code in (401, 403)


def test_revise_applies_the_correction_and_keeps_the_flow_id(monkeypatch):
    revised = {**FLOW, "id": "FLOW-RENAMED", "name": "Invite an agent by email"}
    fake = install(monkeypatch, FakeClaude(text=json.dumps({"flow": revised, "change_summary": "Renamed the flow."})))
    response = _revise({"prd_title": "Invites", "flow": FLOW, "instruction": "Call it invite by email", "credentials": CREDENTIALS})
    assert response.status_code == 200
    body = response.json()
    assert body["flow"]["id"] == "FLOW-OWNER-01"
    assert body["flow"]["name"] == "Invite an agent by email"
    assert body["change_summary"] == "Renamed the flow."
    request = fake.calls[0]
    assert request["output_config"]["format"]["schema"] == analyzer.REVISE_SCHEMA
    prompt = request["messages"][0]["content"][0]["text"]
    assert "Call it invite by email" in prompt and "FLOW-OWNER-01" in prompt


def test_a_revision_keeps_the_flow_in_its_module(monkeypatch):
    install(monkeypatch, FakeClaude(text=json.dumps({"flow": {**FLOW, "module": "Somewhere else"}, "change_summary": "x"})))
    response = _revise({"prd_title": "Invites", "flow": {**FLOW, "module": "Team invites"}, "instruction": "Add a resend step", "credentials": CREDENTIALS})
    assert response.json()["flow"]["module"] == "Team invites"


def test_a_revision_that_does_not_connect_is_rejected_with_502(monkeypatch):
    broken = {**FLOW, "graph": {**GRAPH, "edges": [{"from": "s", "to": "nowhere", "label": ""}]}}
    install(monkeypatch, FakeClaude(text=json.dumps({"flow": broken, "change_summary": "x"})))
    response = _revise({"prd_title": "Invites", "flow": FLOW, "instruction": "Add a step", "credentials": CREDENTIALS})
    assert response.status_code == 502
    assert "Nothing was saved" in response.json()["detail"]


@pytest.mark.parametrize("body", [
    {"prd_title": "Invites", "flow": FLOW, "instruction": "x", "credentials": CREDENTIALS},
    {"prd_title": "Invites", "flow": FLOW, "instruction": "x" * 1001, "credentials": CREDENTIALS},
    {"prd_title": "", "flow": FLOW, "instruction": "Add a step", "credentials": CREDENTIALS},
])
def test_revise_validates_its_input(body):
    assert _revise(body).status_code == 422


def test_revise_without_an_ai_provider_says_so():
    response = _revise({"prd_title": "Invites", "flow": FLOW, "instruction": "Add a step", "credentials": {}})
    assert response.status_code == 422
    assert "No AI provider is connected" in response.json()["detail"]


def test_ai_errors_during_a_revision_return_422(monkeypatch):
    install(monkeypatch, FakeClaude(stop_reason="refusal"))
    response = _revise({"prd_title": "Invites", "flow": FLOW, "instruction": "Add a step", "credentials": CREDENTIALS})
    assert response.status_code == 422
