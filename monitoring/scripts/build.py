"""Builds the Lambda deployment zips into monitoring/build/.

Dependencies are downloaded as Linux (manylinux) wheels for Python 3.12, so the zips work on
Lambda even when built on Windows or macOS.

Usage:  python scripts/build.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
BUILD = ROOT / "build"
FUNCTIONS = ["incident_assistant", "storage_forecast"]


def build(function: str) -> Path:
    staging = BUILD / function
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)

    shutil.copytree(SRC / function, staging / function, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "requirements.txt"))

    requirements = SRC / function / "requirements.txt"
    if requirements.exists():
        subprocess.run(
            [
                sys.executable, "-m", "pip", "install", "--quiet",
                "--requirement", str(requirements),
                "--target", str(staging),
                "--platform", "manylinux2014_x86_64",
                "--implementation", "cp",
                "--python-version", "3.12",
                "--only-binary=:all:",
                "--upgrade",
            ],
            check=True,
        )

    archive = shutil.make_archive(str(BUILD / function), "zip", root_dir=staging)
    return Path(archive)


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    for function in FUNCTIONS:
        archive = build(function)
        print(f"Built {archive.relative_to(ROOT)} ({archive.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
