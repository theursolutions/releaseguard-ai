import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# The shared AI gateway package (copied into the image at build time).
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared"))
