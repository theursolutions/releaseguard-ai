import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

EVENTS = Path(__file__).parent / "events"


@pytest.fixture
def load_event():
    def _load(name: str) -> dict:
        return json.loads((EVENTS / name).read_text(encoding="utf-8"))

    return _load
