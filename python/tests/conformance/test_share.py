"""The ``share-v1`` list codec against the shared conformance corpus.

Each case in ``conformance/share/cases.json`` is either a round-trip
(``{name, list, token}``) or a negative decode (``{name, decode_token,
expected_decode}``). Python must reproduce the reference (TS) token
byte-for-byte and the exact decode verdict. See ``CONFORMANCE.md`` "share/" and
``tools/docs/share-token.md`` for the wire-format contract.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.share import decode_share_token, encode_share_token

from ..conftest import load_corpus_json


def _cases() -> list[dict[str, Any]]:
    return load_corpus_json("share", "cases.json")


def test_share_corpus_is_non_empty() -> None:
    assert len(_cases()) > 0


@pytest.mark.parametrize("case", [c for c in _cases() if "token" in c], ids=lambda c: c["name"])
def test_round_trip_matches_golden(case: dict[str, Any]) -> None:
    # Encode must reproduce the golden token byte-for-byte.
    assert encode_share_token(case["list"]) == case["token"]
    # Decode of the golden token must round-trip to the input list.
    decoded = decode_share_token(case["token"])
    assert decoded == {"ok": True, "list": case["list"]}


@pytest.mark.parametrize(
    "case", [c for c in _cases() if "decode_token" in c], ids=lambda c: c["name"]
)
def test_negative_decode_matches_verdict(case: dict[str, Any]) -> None:
    assert decode_share_token(case["decode_token"]) == case["expected_decode"]
