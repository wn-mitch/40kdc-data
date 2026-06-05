"""Shared fixtures for the wh40kdc test suite.

The conformance tests read the shared corpus at ``<repo>/conformance/``
directly (like the Rust crate's tests do). When the package is tested outside
the repository (e.g. from an installed wheel), those tests are skipped.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS = _REPO_ROOT / "conformance"


def corpus_path(*parts: str) -> Path:
    """Path inside the conformance corpus; skips the test when absent."""
    path = CORPUS.joinpath(*parts)
    if not path.exists():
        pytest.skip(f"conformance corpus not available: {path}")
    return path


def load_corpus_json(*parts: str) -> Any:
    return json.loads(corpus_path(*parts).read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def dataset() -> Any:
    from wh40kdc.data.dataset import Dataset

    return Dataset.embedded()
