from incident_assistant.redact import MAX_LINE_LENGTH, redact


def test_removes_secrets():
    line = (
        "Auth failed key=sk-ant-api03-abcDEF123 aws=AKIAABCDEFGHIJKLMNOP "
        "Authorization: Bearer abc.def.ghi password=hunter2 token: 'xyz789'"
    )
    cleaned = redact(line)
    for secret in ("sk-ant-api03-abcDEF123", "AKIAABCDEFGHIJKLMNOP", "abc.def.ghi", "hunter2", "xyz789"):
        assert secret not in cleaned


def test_removes_personal_data_but_keeps_useful_context():
    cleaned = redact("SQLSTATE[HY000] user ali@example.com phone +60 12-345 6789 from 10.0.12.34 card 4111 1111 1111 1111")
    assert "ali@example.com" not in cleaned
    assert "345 6789" not in cleaned
    assert "4111" not in cleaned
    assert "10.0.12.x" in cleaned
    assert "SQLSTATE[HY000]" in cleaned


def test_removes_jwt():
    assert "eyJ" not in redact("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123_-")


def test_truncates_long_lines():
    assert len(redact("x" * 5000)) == MAX_LINE_LENGTH + 1
