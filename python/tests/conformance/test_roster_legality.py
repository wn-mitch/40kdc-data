"""Tier-aware whole-unit loadout legality against the roster_legality corpus.

Mirrors the runner's ``check_unit_legality`` op: resolve the unit (faction-scoped
when pinned), look up its faction's composition, and compare the sorted
``"code:id"`` violation strings exactly. Ties out with the TS reference and the
Rust/Go ports via ``conformance/roster_legality/cases.json``.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.data.bundle import empty_raw_data
from wh40kdc.data.dataset import Dataset
from wh40kdc.data.loadout import check_unit_legality
from wh40kdc.data.roster import validate_roster_core

from ..conftest import load_corpus_json


def _cases() -> list[dict[str, Any]]:
    return load_corpus_json("roster_legality", "cases.json")


def run_case(ds: Any, args: dict[str, Any]) -> list[str]:
    faction_id = args.get("factionId")
    unit = (
        ds.units.get_in_faction(args["unitId"], faction_id)
        if isinstance(faction_id, str)
        else ds.units.get_any(args["unitId"])
    )
    assert unit is not None, f"unknown unit {args['unitId']}"
    comp = next(
        (
            c
            for c in ds.unit_compositions
            if c.get("unit_id") == args["unitId"]
            and c.get("faction_id") == unit.raw.get("faction_id")
        ),
        None,
    )
    violations = check_unit_legality(
        unit.raw,
        args["modelCount"],
        ds.wargear_options_of(unit.raw),
        {k: int(v) for k, v in (args.get("counts") or {}).items()},
        (comp or {}).get("models"),
        (comp or {}).get("tiers"),
    )
    return sorted(f"{v['code']}:{v['id']}" for v in violations)


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"])
def test_roster_legality_case(dataset: Any, case: dict[str, Any]) -> None:
    assert run_case(dataset, case["args"]) == case["expected"]


def test_conditional_and_name_keywords_satisfy_enhancement_eligibility() -> None:
    raw = empty_raw_data()
    raw["factions"] = [{"id": "fabricated", "name": "Fabricated", "keywords": []}]
    raw["detachments"] = [
        {"id": "fabricated-detachment", "name": "Formation", "faction_id": "fabricated"}
    ]
    raw["units"] = [
        {
            "id": "named-bearer",
            "name": "Named Bearer",
            "faction_id": "fabricated",
            "role": "character",
            "conditional_keywords": [
                {"keyword": "Granted", "required_detachment_id": "fabricated-detachment"}
            ],
        }
    ]
    raw["enhancements"] = [
        {
            "id": "named-relic",
            "name": "Named Relic",
            "detachment_id": "fabricated-detachment",
            "keyword_restriction_groups": [["Granted"], ["Named Bearer"]],
        }
    ]
    result = validate_roster_core(
        {
            "faction_id": "fabricated",
            "detachment_ids": ["fabricated-detachment"],
            "units": [
                {
                    "unit_id": "named-bearer",
                    "model_count": 1,
                    "is_warlord": True,
                    "enhancement_id": "named-relic",
                    "counts": {},
                }
            ],
        },
        Dataset(raw),
    )
    assert "enhancement-keyword-mismatch" not in [v["code"] for v in result["army"]]


def test_enhancement_grants_an_additional_legal_bodyguard() -> None:
    raw = empty_raw_data()
    raw["factions"] = [{"id": "fabricated", "name": "Fabricated", "keywords": []}]
    raw["detachments"] = [
        {"id": "fabricated-detachment", "name": "Formation", "faction_id": "fabricated"}
    ]
    raw["units"] = [
        {"id": "leader", "name": "Leader", "faction_id": "fabricated", "role": "character"},
        {"id": "granted-bodyguard", "name": "Granted Bodyguard", "faction_id": "fabricated"},
    ]
    raw["enhancements"] = [
        {
            "id": "attachment-relic",
            "name": "Attachment Relic",
            "detachment_id": "fabricated-detachment",
            "attachment_bodyguard_ids": ["granted-bodyguard"],
        }
    ]
    result = validate_roster_core(
        {
            "faction_id": "fabricated",
            "detachment_ids": ["fabricated-detachment"],
            "units": [
                {
                    "unit_id": "leader",
                    "model_count": 1,
                    "is_warlord": True,
                    "enhancement_id": "attachment-relic",
                    "leader_bodyguard_id": "granted-bodyguard",
                    "counts": {},
                },
                {
                    "unit_id": "granted-bodyguard",
                    "model_count": 1,
                    "is_warlord": False,
                    "counts": {},
                },
            ],
        },
        Dataset(raw),
    )
    assert "leader-attachment-illegal" not in [v["code"] for v in result["army"]]


def _conditional_attachment_dataset() -> Dataset:
    raw = empty_raw_data()
    raw["factions"] = [{"id": "fabricated", "name": "Fabricated Faction"}]
    raw["units"] = [
        {
            "id": "conditional-character",
            "name": "Conditional Character",
            "role": "character",
            "attachment_role": "leader",
        },
        {"id": "required-character", "name": "Required Character", "role": "character"},
        {"id": "leader-bodyguard", "name": "Leader Bodyguard"},
        {"id": "support-bodyguard", "name": "Support Bodyguard"},
    ]
    for unit in raw["units"]:
        unit["faction_id"] = "fabricated"
    raw["leader_attachments"] = [
        {
            "leader_id": "conditional-character",
            "eligible_bodyguard_ids": [],
            "conditional_groups": [
                {
                    "role": "leader",
                    "eligible_bodyguard_ids": ["leader-bodyguard"],
                    "excluded_roster_unit_ids": ["required-character"],
                },
                {
                    "role": "support",
                    "eligible_bodyguard_ids": ["support-bodyguard"],
                    "required_roster_unit_ids": ["required-character"],
                },
            ],
        }
    ]
    return Dataset(raw)


def test_allied_support_role_falls_back_to_the_unit_without_conditional_groups() -> None:
    raw = empty_raw_data()
    raw["units"] = [
        {
            "id": "example-support",
            "name": "Example Support",
            "faction_id": "allied",
            "attachment_role": "support",
        }
    ]
    dataset = Dataset(raw)
    assert dataset.effective_attachment_role("example-support", set(), "host") == "support"


def test_conditional_attachment_browse_filters_by_roster_context() -> None:
    dataset = _conditional_attachment_dataset()

    assert [u.id for u in dataset.bodyguards_attachable_from("conditional-character")] == [
        "leader-bodyguard",
        "support-bodyguard",
    ]
    assert [u.id for u in dataset.bodyguards_attachable_from("conditional-character", set())] == [
        "leader-bodyguard"
    ]
    assert [
        u.id
        for u in dataset.bodyguards_attachable_from(
            "conditional-character", {"required-character"}
        )
    ] == ["support-bodyguard"]
    assert [
        u.id for u in dataset.leaders_attachable_to("support-bodyguard", {"required-character"})
    ] == ["conditional-character"]


def test_overlapping_conditional_roles_keep_solo_capability() -> None:
    dataset = _conditional_attachment_dataset()
    roster = {"required-character"}
    assert dataset.effective_attachment_role("conditional-character", roster) == "support"
    dataset.leader_attachments[0]["conditional_groups"].append(
        {
            "role": "leader",
            "eligible_bodyguard_ids": ["support-bodyguard"],
            "required_roster_unit_ids": ["required-character"],
        }
    )
    assert dataset.effective_attachment_role("conditional-character", roster) == "leader"


def test_conditional_attachment_role_controls_legality() -> None:
    dataset = _conditional_attachment_dataset()

    leader_only = validate_roster_core(
        {
            "units": [
                {
                    "unit_id": "conditional-character",
                    "model_count": 1,
                    "is_warlord": True,
                    "counts": {},
                }
            ]
        },
        dataset,
    )
    assert "leader-must-attach" not in [v["code"] for v in leader_only["army"]]

    unattached_support = validate_roster_core(
        {
            "units": [
                {
                    "unit_id": "conditional-character",
                    "model_count": 1,
                    "is_warlord": True,
                    "counts": {},
                },
                {
                    "unit_id": "required-character",
                    "model_count": 1,
                    "is_warlord": False,
                    "counts": {},
                },
            ]
        },
        dataset,
    )
    assert "leader-must-attach" in [v["code"] for v in unattached_support["army"]]

    illegal_bodyguard = validate_roster_core(
        {
            "units": [
                {
                    "unit_id": "conditional-character",
                    "model_count": 1,
                    "is_warlord": True,
                    "leader_bodyguard_id": "leader-bodyguard",
                    "counts": {},
                },
                {
                    "unit_id": "required-character",
                    "model_count": 1,
                    "is_warlord": False,
                    "counts": {},
                },
                {
                    "unit_id": "leader-bodyguard",
                    "model_count": 1,
                    "is_warlord": False,
                    "counts": {},
                },
            ]
        },
        dataset,
    )
    assert "leader-attachment-illegal" in [v["code"] for v in illegal_bodyguard["army"]]

    legal_bodyguard = validate_roster_core(
        {
            "units": [
                {
                    "unit_id": "conditional-character",
                    "model_count": 1,
                    "is_warlord": True,
                    "leader_bodyguard_id": "support-bodyguard",
                    "counts": {},
                },
                {
                    "unit_id": "required-character",
                    "model_count": 1,
                    "is_warlord": False,
                    "counts": {},
                },
                {
                    "unit_id": "support-bodyguard",
                    "model_count": 1,
                    "is_warlord": False,
                    "counts": {},
                },
            ]
        },
        dataset,
    )
    assert not {
        violation["code"]
        for violation in legal_bodyguard["army"]
        if violation["code"] in {"leader-attachment-illegal", "leader-must-attach"}
    }
