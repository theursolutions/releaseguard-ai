"""Provider translation tests: SDK clients are faked, everything else (requests, conversions, stop
reasons, error mapping) is the real code."""

import asyncio
import json
from types import SimpleNamespace

import httpx2
import openai
import pytest
from google.genai import errors as genai_errors
from google.genai import types

from releaseguard_ai import AIError, Pdf, Text, ToolCall, ToolResult, make_provider
from releaseguard_ai.errors import translate
from releaseguard_ai.types import parse_json_object, without_additional_properties

TOOLS = [{"name": "get_prd_reviews", "description": "Recent reviews", "input_schema": {"type": "object", "properties": {"limit": {"type": "integer"}}, "required": [], "additionalProperties": False}}]
SCHEMA = {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"], "additionalProperties": False}


def run(gen):
    async def go():
        return [item async for item in gen]

    return asyncio.run(go())


def async_iter(items):
    async def gen():
        for item in items:
            yield item

    return gen()


# ---------------------------------------------------------------- factory & errors

def test_no_provider_means_not_configured():
    with pytest.raises(AIError) as error:
        make_provider(None)
    assert error.value.code == "not_configured" and "Connections page" in error.value.message


@pytest.mark.parametrize("credentials, words", [
    ({"provider": "gemini"}, "No Gemini API key"),
    ({"provider": "openai"}, "No OpenAI API key"),
    ({"provider": "openai_compatible", "model": "m"}, "base URL"),
    ({"provider": "openai_compatible", "base_url": "https://api.groq.com/openai/v1"}, "No model"),
    ({"provider": "openai_compatible", "base_url": "file:///etc/passwd", "model": "m"}, "base URL"),
    ({"provider": "anthropic", "auth_method": "claude_code"}, "Unsupported Claude connection method"),
])
def test_incomplete_credentials_explain_the_next_step(credentials, words):
    with pytest.raises(AIError) as error:
        make_provider(credentials)
    assert error.value.code == "not_configured" and words in error.value.message


def test_sdk_errors_become_plain_messages():
    request = httpx2.Request("POST", "https://api.openai.com/v1/responses")
    assert translate(openai.AuthenticationError("bad", response=httpx2.Response(401, request=request), body=None), "OpenAI").code == "auth_required"
    assert translate(openai.RateLimitError("slow", response=httpx2.Response(429, request=request), body=None), "OpenAI").code == "rate_limited"
    assert translate(openai.APITimeoutError(request=request), "OpenAI").code == "timeout"
    gemini_bad_key = genai_errors.ClientError(400, {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT"}})
    failure = translate(gemini_bad_key, "Gemini")
    assert failure.code == "auth_required" and failure.message == "Gemini rejected the API key. An admin must check the Gemini connection."
    assert translate(genai_errors.ServerError(503, {"error": {"code": 503, "message": "overloaded"}}), "Gemini").code == "unavailable"


def test_no_credit_is_explained_with_the_next_step():
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    body = {"type": "error", "error": {"type": "invalid_request_error", "message": "Your credit balance is too low to access the Anthropic API."}}
    import anthropic

    failure = translate(anthropic.BadRequestError("Your credit balance is too low to access the Anthropic API.", response=httpx2.Response(400, request=request), body=body), "Claude")
    assert failure.code == "no_credit" and "no API credit left" in failure.message and "switch to another provider" in failure.message
    quota = translate(openai.RateLimitError("You exceeded your current quota", response=httpx2.Response(429, request=httpx2.Request("POST", "https://api.openai.com")), body={"error": {"code": "insufficient_quota"}}), "OpenAI")
    assert quota.code == "no_credit"


def test_ping_makes_a_real_tiny_request_so_unusable_keys_are_not_shown_as_connected():
    provider = make_provider({"provider": "anthropic", "auth_method": "api_key", "api_key": "sk-ant-x"})
    calls = []
    provider._clients[False] = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: calls.append(kw) or SimpleNamespace(model="claude-opus-5-5")))
    assert provider.ping() == "Connected to the Claude API. Model claude-opus-5-5 answered."
    assert calls[0]["max_tokens"] == 1


def test_json_helpers():
    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    with pytest.raises(ValueError):
        parse_json_object("[1, 2]")
    assert without_additional_properties({"type": "object", "additionalProperties": False, "properties": {"x": {"type": "object", "additionalProperties": False}}}) == {
        "type": "object", "properties": {"x": {"type": "object"}}
    }


# ---------------------------------------------------------------- Gemini

def gemini():
    return make_provider({"provider": "gemini", "api_key": "AIza-test"})


def test_gemini_structured_request_and_answer():
    provider = gemini()
    captured = {}

    def generate_content(model, contents, config):
        captured.update(model=model, contents=contents, config=config)
        return types.GenerateContentResponse(
            candidates=[types.Candidate(content=types.Content(role="model", parts=[types.Part.from_text(text='{"summary": "ok"}')]), finish_reason=types.FinishReason.STOP)],
            model_version="gemini-3.8-flash",
            usage_metadata=types.GenerateContentResponseUsageMetadata(prompt_token_count=11, candidates_token_count=7),
        )

    provider.client = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
    reply = provider.structured("sys", [Text("hello"), Pdf(b"%PDF", "Spec")], SCHEMA, schema_name="x", max_tokens=100)

    assert reply.data == {"summary": "ok"} and reply.usage == {"input_tokens": 11, "output_tokens": 7}
    assert captured["model"] == "gemini-3.8-flash"
    assert captured["config"].response_mime_type == "application/json"
    assert "additionalProperties" not in json.dumps(captured["config"].response_json_schema)
    parts = captured["contents"][0].parts
    assert parts[0].text == "hello" and parts[1].inline_data.mime_type == "application/pdf"


def test_gemini_structured_truncation_and_safety():
    provider = gemini()
    for reason, code in ((types.FinishReason.MAX_TOKENS, "truncated"), (types.FinishReason.SAFETY, "refused")):
        response = types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=[types.Part.from_text(text="{")]), finish_reason=reason)])
        provider.client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kw: response))
        with pytest.raises(AIError) as error:
            provider.structured("sys", [Text("x")], SCHEMA, schema_name="x", max_tokens=10)
        assert error.value.code == code


def test_gemini_stream_keeps_parts_and_signatures_for_tool_calls():
    provider = gemini()
    call_part = types.Part(function_call=types.FunctionCall(name="get_prd_reviews", args={"limit": 3}), thought_signature=b"sig-1")
    chunks = [
        types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=[types.Part(text="thinking", thought=True), types.Part.from_text(text="Let me check. ")]))]),
        types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=[call_part]), finish_reason=types.FinishReason.STOP)], model_version="gemini-3.8-flash"),
    ]
    captured = {}

    async def generate_content_stream(model, contents, config):
        captured.update(contents=contents, config=config)
        return async_iter(chunks)

    provider.client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=generate_content_stream)))
    events = run(provider.stream_turn("sys", [{"role": "user", "text": "hi"}], TOOLS))

    assert events[:2] == [("text", "Let me check. "), ("tool_planned", "get_prd_reviews")]  # thought text is not shown
    turn = events[-1][1]
    assert turn.stop == "tool_use"
    assert turn.tool_calls == [ToolCall("gemini-call-2", "get_prd_reviews", {"limit": 3})]
    assert len(turn.raw.parts) == 3 and turn.raw.parts[2].thought_signature == b"sig-1"  # unchanged, unmerged
    declaration = captured["config"].tools[0].function_declarations[0]
    assert declaration.name == "get_prd_reviews" and declaration.parameters_json_schema == TOOLS[0]["input_schema"]
    assert captured["config"].automatic_function_calling.disable is True

    # Next request: the model turn is sent back unchanged, then the tool result (generated id not sent).
    chunks[:] =[types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=[types.Part.from_text(text="None yet.")]), finish_reason=types.FinishReason.STOP)])]
    events = run(provider.stream_turn("sys", [
        {"role": "user", "text": "hi"},
        {"role": "turn", "turn": turn},
        {"role": "tool_results", "results": [ToolResult("gemini-call-2", "get_prd_reviews", '{"reviews": []}')]},
    ], TOOLS))
    contents = captured["contents"]
    assert contents[1] is turn.raw
    response_part = contents[2].parts[0].function_response
    assert contents[2].role == "user" and response_part.name == "get_prd_reviews" and response_part.id is None
    assert response_part.response == {"output": {"reviews": []}}
    assert events[-1][1].stop == "end"


# ---------------------------------------------------------------- OpenAI (Responses API)

def openai_provider():
    return make_provider({"provider": "openai", "api_key": "sk-test"})


def test_openai_structured_uses_strict_json_schema_and_stores_nothing(monkeypatch):
    provider = openai_provider()
    captured = {}
    response = SimpleNamespace(
        status="completed", incomplete_details=None, output=[SimpleNamespace(type="message", content=[SimpleNamespace(type="output_text", text='{"summary": "ok"}')])],
        output_text='{"summary": "ok"}', model="gpt-6.1-sol", usage=SimpleNamespace(input_tokens=3, output_tokens=4),
    )
    client = SimpleNamespace(responses=SimpleNamespace(create=lambda **kw: captured.update(kw) or response))
    monkeypatch.setattr(provider, "_client", lambda async_client=False: client)

    reply = provider.structured("sys", [Text("hello"), Pdf(b"%PDF", "Spec")], SCHEMA, schema_name="prd_review", max_tokens=50)
    assert reply.data == {"summary": "ok"} and reply.model == "gpt-6.1-sol"
    assert captured["store"] is False and captured["instructions"] == "sys"
    assert captured["text"]["format"] == {"type": "json_schema", "name": "prd_review", "schema": SCHEMA, "strict": True}
    content = captured["input"][0]["content"]
    assert content[0] == {"type": "input_text", "text": "hello"}
    assert content[1]["type"] == "input_file" and content[1]["file_data"].startswith("data:application/pdf;base64,")


def test_openai_stream_maps_events_and_replays_reasoning(monkeypatch):
    provider = openai_provider()
    reasoning = SimpleNamespace(type="reasoning", model_dump=lambda exclude_none: {"type": "reasoning", "id": "rs_1", "encrypted_content": "enc", "summary": []})
    call = SimpleNamespace(type="function_call", call_id="call_1", name="get_prd_reviews", arguments='{"limit": 2}')
    final = SimpleNamespace(status="completed", incomplete_details=None, output=[reasoning, call], model="gpt-6.1-sol", usage=SimpleNamespace(input_tokens=1, output_tokens=2))
    events = [
        SimpleNamespace(type="response.output_item.added", item=SimpleNamespace(type="function_call", name="get_prd_reviews")),
        SimpleNamespace(type="response.completed", response=final),
    ]
    captured = {}

    class Stream:
        def __init__(self):
            self.closed = False

        def __aiter__(self):
            return async_iter(events)

        async def close(self):
            self.closed = True

    stream = Stream()

    async def create(**kw):
        captured.update(kw)
        return stream

    monkeypatch.setattr(provider, "_client", lambda async_client=False: SimpleNamespace(responses=SimpleNamespace(create=create)))
    result = run(provider.stream_turn("sys", [{"role": "user", "text": "hi"}], TOOLS))

    assert result[0] == ("tool_planned", "get_prd_reviews")
    turn = result[-1][1]
    assert turn.stop == "tool_use" and turn.tool_calls == [ToolCall("call_1", "get_prd_reviews", {"limit": 2})]
    assert turn.raw == [{"type": "reasoning", "id": "rs_1", "encrypted_content": "enc", "summary": []},
                        {"type": "function_call", "call_id": "call_1", "name": "get_prd_reviews", "arguments": '{"limit": 2}'}]
    assert captured["store"] is False and captured["include"] == ["reasoning.encrypted_content"] and captured["stream"] is True
    assert captured["tools"][0]["type"] == "function" and captured["tools"][0]["parameters"] == TOOLS[0]["input_schema"]
    assert stream.closed

    from releaseguard_ai.openai_provider import _input
    items = _input([{"role": "user", "text": "hi"}, {"role": "turn", "turn": turn}, {"role": "tool_results", "results": [ToolResult("call_1", "get_prd_reviews", "[]")]}])
    assert items[0] == {"role": "user", "content": "hi"}
    assert items[-1] == {"type": "function_call_output", "call_id": "call_1", "output": "[]"}


# ---------------------------------------------------------------- OpenAI-compatible (Chat Completions)

def compatible():
    return make_provider({"provider": "openai_compatible", "name": "Groq", "base_url": "https://api.groq.com/openai/v1/", "api_key": "gsk_x", "model": "llama-4"})


def test_compatible_structured_falls_back_when_json_schema_is_unsupported(monkeypatch):
    provider = compatible()
    formats = []
    ok = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content='```json\n{"summary": "ok"}\n```', refusal=None))], model="llama-4", usage=None)
    request = httpx2.Request("POST", "https://api.groq.com/openai/v1/chat/completions")

    def create(**kw):
        formats.append((kw.get("response_format") or {}).get("type"))
        if formats[-1] == "json_schema":
            raise openai.BadRequestError("json_schema not supported", response=httpx2.Response(400, request=request), body=None)
        return ok

    monkeypatch.setattr(provider, "_client", lambda async_client=False: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    reply = provider.structured("sys", [Text("hello")], SCHEMA, schema_name="x", max_tokens=50)
    assert reply.data == {"summary": "ok"} and formats == ["json_schema", "json_object"]
    assert provider.base_url == "https://api.groq.com/openai/v1" and provider.label == "Groq"


def test_compatible_cannot_read_pdfs_and_says_so():
    with pytest.raises(AIError) as error:
        compatible().structured("sys", [Pdf(b"%PDF")], SCHEMA, schema_name="x", max_tokens=10)
    assert error.value.code == "unsupported" and "Groq cannot read PDF files" in error.value.message


def test_compatible_stream_assembles_tool_call_fragments(monkeypatch):
    provider = compatible()

    def chunk(content=None, tool_calls=None, finish=None):
        return SimpleNamespace(model="llama-4", choices=[SimpleNamespace(finish_reason=finish, delta=SimpleNamespace(content=content, tool_calls=tool_calls))])

    fragment = lambda **kw: SimpleNamespace(index=0, id=kw.get("id"), function=SimpleNamespace(name=kw.get("name"), arguments=kw.get("args")))
    chunks = [chunk(content="Checking. "), chunk(tool_calls=[fragment(id="c1", name="get_prd_reviews", args='{"li')]), chunk(tool_calls=[fragment(args='mit": 4}')]), chunk(finish="tool_calls")]

    class Stream:
        def __aiter__(self):
            return async_iter(chunks)

        async def close(self):
            pass

    async def create(**kw):
        return Stream()

    monkeypatch.setattr(provider, "_client", lambda async_client=False: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    events = run(provider.stream_turn("sys", [{"role": "user", "text": "hi"}], TOOLS))
    assert events[:2] == [("text", "Checking. "), ("tool_planned", "get_prd_reviews")]
    turn = events[-1][1]
    assert turn.stop == "tool_use" and turn.tool_calls == [ToolCall("c1", "get_prd_reviews", {"limit": 4})]
    assert turn.raw == {"role": "assistant", "content": "Checking. ", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "get_prd_reviews", "arguments": '{"limit": 4}'}}]}
