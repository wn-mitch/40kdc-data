"""Abilities resolver + DSL→Buff translation against the abilities-resolver
conformance corpus.

The eligible-abilities cases compare ability-id sets grouped by source kind
(order within kinds is unpinned); the from-dsl cases pin applied-buff list
order, unsupported-reason strings, and activatable levers.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from wh40kdc.abilities_resolver import stratagem_can_target
from wh40kdc.cruncher import effect_to_buffs
from wh40kdc.data.ability_refs import with_rating

from ..conftest import CORPUS

_DIR = CORPUS / "abilities-resolver"
_RESOLVER_CASES = (
    sorted(p.name for p in _DIR.glob("0*.json"))
    if _DIR.exists()
    else []
)


@pytest.mark.skipif(not _RESOLVER_CASES, reason="conformance corpus not available")
@pytest.mark.parametrize("case_file", _RESOLVER_CASES)
def test_eligible_abilities(dataset: Any, case_file: str) -> None:
    case = json.loads((_DIR / case_file).read_text(encoding="utf-8"))
    grouped: dict[str, list[str]] = {}
    for entry in dataset.eligible_abilities(case["input"], case["phase"]):
        grouped.setdefault(entry["source"]["kind"], []).append(entry["ability"].id)
    for ids in grouped.values():
        ids.sort()
    assert grouped == case["expected"]


_TARGET_CASES = (
    json.loads((_DIR / "stratagem-targets.json").read_text(encoding="utf-8"))["cases"]
    if (_DIR / "stratagem-targets.json").exists()
    else []
)


@pytest.mark.skipif(not _TARGET_CASES, reason="conformance corpus not available")
@pytest.mark.parametrize("case", _TARGET_CASES, ids=lambda case: case["name"])
def test_stratagem_can_target(case: dict[str, Any]) -> None:
    stratagem = {"target_restrictions": case["target_restrictions"]}
    assert stratagem_can_target(stratagem, set(case["keywords"])) is case["expected"]


def _run_dsl_corpus(dataset: Any, filename: str) -> None:
    dsl = json.loads((_DIR / filename).read_text(encoding="utf-8"))
    for c in dsl["cases"]:
        perspective = c.get("perspective", "attacker")
        if "effect" in c:
            effect = with_rating(c["effect"], c.get("rating"))
            result = effect_to_buffs(effect, c["source"], c["context"], perspective)
        else:
            ability = dataset.abilities.get_any(c["abilityId"])
            assert ability is not None, f"unknown ability {c['abilityId']}"
            result = ability.describe_buffs(
                c["source"],
                c["context"],
                perspective,
                c.get("rating"),
            )
        applied_contribs = [b["contribution"] for b in result["applied"]]
        message = f"{c['abilityId']} ({perspective})"
        assert applied_contribs == c["expected"]["applied"], message
        reasons = [u["reason"] for u in result["unsupported"]]
        assert reasons == c["expected"]["unsupportedReasons"], message
        # Each applied buff's gate (None when ungated), pinned on the rows that carry it.
        if c["expected"].get("applicableWhen") is not None:
            gates = [b.get("applicableWhen") for b in result["applied"]]
            assert gates == c["expected"]["applicableWhen"], f"buff gates for {message}"
        if "activatable" in c["expected"]:
            acts = [
                {
                    "id": a["id"],
                    "label": a["label"],
                    "group": a.get("group"),
                    "groups": a.get("groups"),
                    "requires": a.get("requires"),
                    "capRaise": a.get("capRaise"),
                    "buffs": [b["contribution"] for b in a["buffs"]],
                }
                for a in result["activatable"]
            ]
            # Expected levers omit optional metadata when it is absent.
            expected_acts = [
                {
                    "group": None,
                    "groups": None,
                    "requires": None,
                    "capRaise": None,
                    **e,
                }
                for e in c["expected"]["activatable"]
            ]
            assert acts == expected_acts, message


@pytest.mark.skipif(not _DIR.exists(), reason="conformance corpus not available")
def test_from_dsl_corpus(dataset: Any) -> None:
    _run_dsl_corpus(dataset, "from-dsl.json")


@pytest.mark.skipif(not _DIR.exists(), reason="conformance corpus not available")
def test_defensive_from_dsl_corpus(dataset: Any) -> None:
    _run_dsl_corpus(dataset, "defensive-from-dsl.json")
