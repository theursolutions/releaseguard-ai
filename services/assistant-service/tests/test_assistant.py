import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app import agent, main, tools
from releaseguard_ai import ToolCall, ToolResult, Turn
from releaseguard_ai.anthropic_provider import AnthropicProvider
from app.main import app

TOKEN = "test-service-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("PORTAL_INTERNAL_URL", "http://portal.test")


class ScriptedProvider:
    """A fake provider: each turn is a list of ("tool_planned"|"text", value) plus a final Turn."""

    label = "Claude"
    name = "anthropic"
    model = "claude-opus-5-5"

    def __init__(self, turns):
        self.turns = list(turns)
        self.seen = []

    async def stream_turn(self, system, conversation, tools_):
        self.seen.append(list(conversation))
        events, final = self.turns.pop(0)
        for event in events:
            yield event
        yield "final", final


def collect(adapter, executor, message="How are we doing?"):
    async def go():
        return [item async for item in agent.run(adapter, [], message, executor, "system")]

    return asyncio.run(go())


def test_text_answer_streams_with_real_state_changes():
    adapter = ScriptedProvider([([("text", "All "), ("text", "good.")], Turn("end", [], model="claude-opus-5-5"))])
    events = collect(adapter, executor=None)
    assert [e["event"] for e in events] == ["state", "text", "text", "done"]
    assert events[0]["data"] == {"state": "RESPONDING"}  # only once text really arrives
    assert events[-1]["data"]["model"] == "claude-opus-5-5"


def test_tool_call_is_executed_and_result_returned_to_the_model():
    calls = []

    async def executor(name, data):
        calls.append((name, data))
        return {"ok": True, "data": {"critical": 1}}

    first = Turn("tool_use", ["<provider-native turn>"], [ToolCall("tu_1", "get_monitoring_status", {"state": "ALARM"})])
    adapter = ScriptedProvider([
        ([("tool_planned", "get_monitoring_status")], first),
        ([("text", "One critical alarm.")], Turn("end", [])),
    ])
    events = collect(adapter, executor)

    assert [e["event"] for e in events] == ["state", "tool_start", "tool_result", "state", "text", "done"]
    assert events[0]["data"] == {"state": "ANALYZING"}
    assert events[2]["data"] == {"id": "tu_1", "name": "get_monitoring_status", "ok": True, "data": {"critical": 1}}
    assert calls == [("get_monitoring_status", {"state": "ALARM"})]
    second_turn = adapter.seen[1]
    assert second_turn[-2] == {"role": "turn", "turn": first}  # the provider's own turn, passed back unchanged
    assert second_turn[-1] == {"role": "tool_results", "results": [ToolResult("tu_1", "get_monitoring_status", '{"critical": 1}', False)]}


def test_refusal_is_reported_not_hidden():
    adapter = ScriptedProvider([([], Turn("refusal", []))])
    events = collect(adapter, executor=None)
    assert events[-1] == {"event": "error", "data": {"code": "refused", "message": "Claude declined to answer this request."}}


def test_runaway_tool_loops_are_stopped():
    async def executor(name, data):
        return {"ok": True, "data": {}}

    turn = ([], Turn("tool_use", [], [ToolCall("t", "get_portfolio_overview", {})]))
    events = collect(ScriptedProvider([turn] * agent.MAX_TOOL_TURNS), executor)
    assert events[-1]["data"]["code"] == "too_many_steps"


@pytest.mark.parametrize(
    "name, data, problem",
    [
        ("drop_database", {}, "Unknown tool"),
        ("get_prd_reviews", {"limit": 500}, "out of range"),
        ("get_prd_reviews", {"limit": "5"}, "must be a integer"),
        ("get_prd_review_details", {}, "Missing required field"),
        ("get_monitoring_status", {"state": "ALARM", "sql": "1=1"}, "Unexpected field"),
        ("get_monitoring_status", {"state": "BROKEN"}, "must be one of"),
    ],
)
def test_tool_input_is_validated_before_anything_runs(name, data, problem):
    ok, message = tools.validate_input(name, data)
    assert not ok and problem in message


def test_executor_calls_only_the_configured_portal_with_service_token_and_user_context():
    seen = {}

    def handler(request: httpx.Request):
        seen.update(url=str(request.url), auth=request.headers["Authorization"], context=request.headers["X-Assistant-Context"], body=json.loads(request.content))
        return httpx.Response(200, json={"alarms": []})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await tools.PortalToolExecutor("signed-context", http)("get_monitoring_status", {"state": "ALARM"})

    result = asyncio.run(go())
    assert result == {"ok": True, "data": {"alarms": []}}
    assert seen == {"url": "http://portal.test/internal/assistant/tools/get_monitoring_status", "auth": f"Bearer {TOKEN}", "context": "signed-context", "body": {"input": {"state": "ALARM"}}}


def test_executor_reports_forbidden_data_instead_of_failing():
    async def go():
        transport = httpx.MockTransport(lambda request: httpx.Response(403))
        async with httpx.AsyncClient(transport=transport) as http:
            return await tools.PortalToolExecutor("ctx", http)("get_team_activity", {})

    assert asyncio.run(go()) == {"ok": False, "error": "Not authorised to read this data."}


def test_executor_rejects_invalid_input_without_calling_the_portal():
    async def go():
        transport = httpx.MockTransport(lambda request: pytest.fail("portal must not be called"))
        async with httpx.AsyncClient(transport=transport) as http:
            return await tools.PortalToolExecutor("ctx", http)("get_prd_reviews", {"limit": 0})

    assert asyncio.run(go())["ok"] is False


def test_claude_provider_maps_sdk_stream_events():
    final = SimpleNamespace(
        stop_reason="tool_use", model="claude-opus-5-5", usage=SimpleNamespace(input_tokens=10, output_tokens=4),
        content=[SimpleNamespace(type="text", text="Checking."), SimpleNamespace(type="tool_use", id="tu_9", name="get_prd_reviews", input={"limit": 3})],
    )

    class FakeStream:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def __aiter__(self):
            async def gen():
                yield SimpleNamespace(type="text", text="Checking.")
                yield SimpleNamespace(type="content_block_start", content_block=SimpleNamespace(type="tool_use", name="get_prd_reviews"))
            return gen()

        async def get_final_message(self):
            return final

    captured = {}

    def stream(**kwargs):
        captured.update(kwargs)
        return FakeStream()

    provider = AnthropicProvider({"auth_method": "api_key", "api_key": "sk-ant-x"})
    provider._clients[True] = SimpleNamespace(messages=SimpleNamespace(stream=stream))

    async def go():
        return [e async for e in provider.stream_turn("sys", [{"role": "user", "text": "hi"}], tools.TOOLS)]

    events = asyncio.run(go())
    assert events[0] == ("text", "Checking.")
    assert events[1] == ("tool_planned", "get_prd_reviews")
    result = events[2][1]
    assert result.stop == "tool_use"
    assert result.tool_calls == [ToolCall("tu_9", "get_prd_reviews", {"limit": 3})]
    assert captured["tools"] == tools.TOOLS and captured["output_config"] == {"effort": "low"}
    assert captured["messages"] == [{"role": "user", "content": "hi"}]


client = TestClient(app)


def test_status_without_credentials_is_auth_required():
    body = client.post("/v1/status", json={}, headers=AUTH).json()
    assert body["state"] == "auth_required"
    assert "Connections" in body["message"]


def test_status_for_withdrawn_subscription_sign_in_is_rejected():
    response = client.post("/v1/status", json={"credentials": {"llm": {"provider": "anthropic", "auth_method": "claude_code", "oauth_token": "x"}}}, headers=AUTH)
    assert response.status_code == 422


def test_chat_without_credentials_streams_an_honest_error():
    with client.stream("POST", "/v1/chat", json={"message": "hi", "context_token": "ctx-1234567890"}, headers=AUTH) as response:
        body = "".join(response.iter_text())
    assert "event: error" in body and '"code": "auth_required"' in body
    assert "event: text" not in body  # nothing is fabricated


def test_chat_streams_scripted_answer_end_to_end(monkeypatch):
    adapter = ScriptedProvider([([("text", "Hello Umer.")], Turn("end", [], model="gemini-3.8-flash"))])
    seen = {}
    monkeypatch.setattr(main, "make_provider", lambda credentials, **k: seen.update(credentials=credentials) or adapter)
    payload = {"message": "hi", "context_token": "ctx-1234567890", "credentials": {"llm": {"provider": "gemini", "api_key": "AIza-x"}}, "history": [{"role": "user", "content": "earlier"}, {"role": "assistant", "content": "answer"}]}
    with client.stream("POST", "/v1/chat", json=payload, headers=AUTH) as response:
        body = "".join(response.iter_text())
    assert 'event: text\ndata: {"delta": "Hello Umer."}' in body and "event: done" in body
    assert seen["credentials"]["provider"] == "gemini"
    assert adapter.seen[0][:2] == [{"role": "user", "text": "earlier"}, {"role": "assistant", "text": "answer"}]


def test_provider_errors_mid_stream_become_readable_errors(monkeypatch):
    class Failing(ScriptedProvider):
        label = "Gemini"

        async def stream_turn(self, system, conversation, tools_):
            yield "text", "Partial "
            raise RuntimeError("socket closed")

    monkeypatch.setattr(main, "make_provider", lambda credentials, **k: Failing([]))
    payload = {"message": "hi", "context_token": "ctx-1234567890", "credentials": {"llm": {"provider": "gemini", "api_key": "AIza-x"}}}
    with client.stream("POST", "/v1/chat", json=payload, headers=AUTH) as response:
        body = "".join(response.iter_text())
    assert "Partial " in body and '"code": "provider_error"' in body and "contacting Gemini" in body


def test_status_reports_the_provider_in_use(monkeypatch):
    provider = SimpleNamespace(name="openai", label="OpenAI", model="gpt-6.1-sol", ping=lambda: "Connected to OpenAI. Model gpt-6.1-sol is available.")
    monkeypatch.setattr(main, "make_provider", lambda credentials, **k: provider)
    body = client.post("/v1/status", json={"credentials": {"llm": {"provider": "openai", "api_key": "sk-x"}}}, headers=AUTH).json()
    assert body == {"state": "connected", "message": "Connected to OpenAI. Model gpt-6.1-sol is available.", "provider": "openai", "provider_label": "OpenAI", "model": "gpt-6.1-sol"}


def test_chat_requires_the_service_token():
    assert client.post("/v1/chat", json={"message": "hi", "context_token": "ctx-1234567890"}).status_code == 401


@pytest.mark.parametrize(
    "name, data, problem",
    [
        ("get_prd_flow", {}, "Missing required field"),
        ("get_prd_flow", {"review_id": 0}, "out of range"),
        ("get_prd_flow", {"review_id": 1, "flow": "x" * 121}, "too long"),
        ("get_platform_status", {"verbose": True}, "Unexpected field"),
        ("get_toolkit_inventory", {"path": "/etc"}, "Unexpected field"),
    ],
)
def test_new_tool_inputs_are_validated(name, data, problem):
    ok, message = tools.validate_input(name, data)
    assert not ok and problem in message


def test_new_tools_accept_valid_input():
    assert tools.validate_input("get_prd_flow", {"review_id": 3, "flow": "FLOW-AGENT-01"}) == (True, "")
    assert tools.validate_input("get_platform_status", {}) == (True, "")
    assert tools.validate_input("get_toolkit_inventory", {}) == (True, "")


def test_selected_prd_review_reaches_the_system_prompt(monkeypatch):
    systems = []

    class Recording(ScriptedProvider):
        async def stream_turn(self, system, conversation, tools_):
            systems.append(system)
            async for item in super().stream_turn(system, conversation, tools_):
                yield item

    adapter = Recording([([("text", "Ok.")], Turn("end", []))])
    monkeypatch.setattr(main, "make_provider", lambda credentials, **k: adapter)
    payload = {"message": "Show the invite flow", "context_token": "ctx-1234567890", "prd_review": {"id": 7, "title": "Agent invites"}, "credentials": {"llm": {"provider": "gemini", "api_key": "AIza-x"}}}
    with client.stream("POST", "/v1/chat", json=payload, headers=AUTH) as response:
        "".join(response.iter_text())
    assert 'selected the PRD review "Agent invites" (review_id 7)' in systems[0]
    assert "selected the PRD review" not in agent.system_prompt("Umer", None)


def test_the_prompt_stops_the_model_searching_flows_for_answers_they_do_not_hold():
    # A pricing question once made the model open flow after flow until the tool-turn limit.
    prompt = agent.system_prompt("Umer", None, {"id": 2, "title": "Monetization"})
    assert "Use the PRD tools only for questions about PRD reviews" in prompt
    assert "Do not open flow after flow searching for an answer." in prompt
    assert "only when the person asks about a flow" in prompt


def test_selected_prd_review_is_validated():
    payload = {"message": "hi", "context_token": "ctx-1234567890", "prd_review": {"id": 0, "title": ""}}
    assert client.post("/v1/chat", json=payload, headers=AUTH).status_code == 422
