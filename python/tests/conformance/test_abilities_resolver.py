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

from wh40kdc.abilities_resolver import stratagem_can_target, stratagem_can_target_unit
from wh40kdc.cruncher import effect_to_buffs, mortal_wound_sources, resolve_granted_records
from wh40kdc.data.ability_refs import with_rating
from wh40kdc.data.normalize import normalize_name

from ..conftest import CORPUS

_DIR = CORPUS / "abilities-resolver"
_RESOLVER_CASES = (
    sorted(p.name for p in _DIR.glob("[0-9]*.json"))
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
    if "members" not in case:
        assert stratagem_can_target(stratagem, set(case["keywords"])) is case["expected"]
        return
    listed = case.get("printed")
    printed = {normalize_name(k) for k in listed} if listed is not None else None
    got = stratagem_can_target_unit(
        stratagem,
        [set(member) for member in case["members"]],
        case.get("trigger_subject"),
        lambda keyword: printed is None or normalize_name(keyword) in printed,
    )
    assert got is case["expected"]


def _run_dsl_corpus(dataset: Any, filename: str) -> None:
    dsl = json.loads((_DIR / filename).read_text(encoding="utf-8"))
    for c in dsl["cases"]:
        perspective = c.get("perspective", "attacker")
        if "effect" in c:
            effect = c["effect"]
            records = c.get("grantedRecords")
            if records is not None:
                effect = resolve_granted_records(effect, records.get, {c["source"]["abilityId"]})
            effect = with_rating(effect, c.get("rating"))
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
        if "unsupportedScopes" in c["expected"]:
            scopes = [u.get("scope") for u in result["unsupported"]]
            assert scopes == c["expected"]["unsupportedScopes"], f"scopes for {message}"
        need_keys = [n["key"] for u in result["unsupported"] for n in u.get("needs", [])]
        assert need_keys == c["expected"].get("needKeys", []), f"need keys for {message}"
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
                    "requiresOption": a.get("requiresOption"),
                    "excludesOption": a.get("excludesOption"),
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
                    "requiresOption": None,
                    "excludesOption": None,
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


_MORTAL_CASES = (
    json.loads((_DIR / "mortal-sources.json").read_text(encoding="utf-8"))["cases"]
    if (_DIR / "mortal-sources.json").exists()
    else []
)


@pytest.mark.skipif(not _MORTAL_CASES, reason="conformance corpus not available")
@pytest.mark.parametrize("case", _MORTAL_CASES, ids=lambda case: case["caseId"])
def test_mortal_wound_sources(dataset: Any, case: dict[str, Any]) -> None:
    """Standalone mortal wounds: ids, moments, need keys and reasons match exactly, the
    expected counts to 1e-9."""
    faction_id = case.get("factionId")
    if faction_id is not None:
        record = dataset.abilities.get_in_faction(case["abilityId"], faction_id)
        assert record is not None, f"unknown ability {case['abilityId']}"
        ability_id, effect, trigger = record.id, record.raw.get("effect"), record.raw.get("trigger")
    else:
        ability_id, effect, trigger = case["abilityId"], case.get("effect"), case.get("trigger")
    result = mortal_wound_sources(ability_id, effect, trigger, case["context"], case.get("rating"))
    want = case["expected"]
    got = [
        {
            "id": s["id"],
            "moment": s["moment"],
            "needKeys": [n["key"] for n in s["needs"]],
        }
        for s in result["sources"]
    ]
    assert got == [
        {"id": s["id"], "moment": s["moment"], "needKeys": s["needKeys"]} for s in want["sources"]
    ]
    for found, expected in zip(result["sources"], want["sources"], strict=True):
        assert found["expected"] == pytest.approx(expected["expected"], abs=1e-9), found["id"]
    assert [u["reason"] for u in result["unsupported"]] == want["unsupportedReasons"]
