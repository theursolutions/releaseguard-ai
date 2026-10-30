import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# The service reuses Module E's incident assistant package (copied into the image at build time).
sys.path.insert(0, str(ROOT.parents[1] / "monitoring" / "src"))
sys.path.insert(0, str(ROOT.parent / "shared"))  # the shared AI gateway package
