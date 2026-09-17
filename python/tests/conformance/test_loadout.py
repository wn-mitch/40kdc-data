"""Loadout totals against the `loadout` conformance corpus.

Pins the damage-level totaling (sum after-FNP across weapons → kills once).
±5e-4 on both fields; the ts↔py differ enforces the same goldens cross-impl.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from wh40kdc.compare import LoadoutLine, loadout_cell

from ..conftest import CORPUS

_DIR = CORPUS / "loadout"
_CASES = sorted(p.name for p in _DIR.glob("*.json")) if _DIR.exists() else []

TOLERANCE = 5e-4


@pytest.mark.skipif(not _CASES, reason="conformance corpus not available")
@pytest.mark.parametrize("case_file", _CASES)
def test_loadout_case(dataset: Any, case_file: str) -> None:
    case = json.loads((_DIR / case_file).read_text(encoding="utf-8"))
    lines = [
        LoadoutLine(
            weapon_id=line["weaponId"],
            count=line["count"],
            profile_index=line.get("profileIndex", 0),
        )
        for line in case["lines"]
    ]
    cell = loadout_cell(
        dataset,
        lines=lines,
        target_profile_id=case["targetProfileId"],
        distance=case["distance"],
        phase=case["phase"],
    )
    assert cell["damage"] == pytest.approx(case["expected"]["damage"], abs=TOLERANCE), case_file
    assert cell["kills"] == pytest.approx(case["expected"]["kills"], abs=TOLERANCE), case_file


def test_completion_relaxes_a_repeated_co_item_after_strict_counts_fail() -> None:
    """A source may count a shared part once per printed choice branch."""
    from wh40kdc.data.loadout import complete_loadout

    completed = complete_loadout(
        {"id": "fabricated-unit", "weapon_ids": ["rifle"]},
        2,
        [
            {
                "replaces": ["rifle"],
                "replacement_choice": [
                    ["shared-part", "blade"],
                    ["shared-part", "lance"],
                ],
                "model_constraint": {"any_number": True},
            }
        ],
        [{"name": "Trooper", "min": 2, "max": 2, "default_weapon_ids": ["rifle"]}],
        # The importer has accumulated the shared printed part from both
        # branches. It cannot be carried four times by two models.
        {"shared-part": 4, "blade": 1, "lance": 1},
    )

    assert completed is not None
    assert completed["counts"] == {"shared-part": 2, "blade": 1, "lance": 1}


def test_completion_handles_many_sparse_explicit_row_choices() -> None:
    """A sparse import must not search every omitted-default combination first."""
    from wh40kdc.data.loadout import complete_loadout

    models = [
        {
            "name": f"Trooper {index}",
            "min": 1,
            "max": 1,
            "default_weapon_ids": [f"alpha-{index}"],
            "loadout_variants": [
                {"name": "Default", "weapon_ids": [f"alpha-{index}"]},
                {"name": "Printed", "weapon_ids": [f"zulu-{index}"]},
            ],
        }
        for index in range(18)
    ]
    explicit = {f"zulu-{index}": 1 for index in range(18)}

    completed = complete_loadout(
        {"id": "fabricated-unit", "weapon_ids": []},
        18,
        [],
        models,
        explicit,
    )

    assert completed is not None
    assert completed["counts"] == explicit


def test_grouping_prefers_the_same_candidate_order_for_ambiguous_models() -> None:
    from wh40kdc.data.loadout import group_loadout

    groups = group_loadout(
        {"id": "fabricated-unit", "weapon_ids": ["rifle"]},
        2,
        [
            {
                "replaces": ["rifle"],
                "replacement_choice": [["alpha"], ["beta"]],
                "model_constraint": {"any_number": True},
            }
        ],
        [{"name": "Trooper", "min": 2, "max": 2, "default_weapon_ids": ["rifle"]}],
        {"alpha": 1, "beta": 1},
    )

    assert groups == [
        {"model_name": "Trooper", "count": 1, "weapons": [{"id": "alpha", "count": 1}]},
        {"model_name": "Trooper", "count": 1, "weapons": [{"id": "beta", "count": 1}]},
    ]


def test_variant_candidates_follow_declared_traversal_and_respect_budgets() -> None:
    from wh40kdc.data.loadout import loadout_candidates

    models = [
        {
            "name": "Trooper",
            "min": 5,
            "max": 5,
            "loadout_variants": [
                {"name": "Rifle", "weapon_ids": ["rifle"]},
                {"name": "Plasma", "weapon_ids": ["plasma"], "max_count": 2},
                {"name": "Melta", "weapon_ids": ["melta"], "max_count": 2},
            ],
            "loadout_variant_budgets": [
                {
                    "variant_names": ["Plasma", "Melta"],
                    "count": 1,
                    "per_models": 5,
                    "scope": "model-row",
                }
            ],
        }
    ]
    candidates = loadout_candidates({"id": "u"}, 5, [], models)
    assert candidates[0] == "Rifle×5 => rifle:5"
    assert "Plasma×1;Melta×1" not in "\n".join(candidates)


def test_variants_use_options_without_bypassing_variant_caps() -> None:
    from wh40kdc.data.loadout import loadout_candidates, validate_loadout

    models = [
        {
            "name": "Trooper",
            "min": 2,
            "max": 2,
            "loadout_variants": [
                {"name": "Rifle", "weapon_ids": ["rifle"]},
                {"name": "Plasma", "weapon_ids": ["plasma"], "max_count": 1},
            ],
            "loadout_variant_budgets": [
                {
                    "variant_names": ["Plasma"],
                    "count": 1,
                    "per_models": 0,
                    "scope": "unit",
                }
            ],
        }
    ]
    options = [
        {
            "replaces": ["rifle"],
            "replacement": ["plasma"],
            "model_constraint": {"any_number": True},
        },
        {
            "replacement": ["scanner"],
            "model_constraint": {"max_count": 1},
        },
    ]

    candidates = loadout_candidates({"id": "u"}, 2, options, models)
    assert any(
        candidate.split(" => ")[1] == "plasma:1,rifle:1,scanner:1" for candidate in candidates
    )
    for candidate in candidates:
        counts = dict(
            (item.split(":")[0], int(item.split(":")[1]))
            for item in candidate.split(" => ")[1].split(",")
        )
        assert validate_loadout({"id": "u"}, 2, options, counts, models) == []
    assert validate_loadout({"id": "u"}, 2, options, {"plasma": 2}, models)
    assert validate_loadout({"id": "u"}, 2, options, {"plasma": 2, "scanner": 1}, models)
    assert (
        validate_loadout({"id": "u"}, 2, options, {"rifle": 1, "plasma": 1, "scanner": 1}, models)
        == []
    )


def test_variant_legality_is_exact_even_when_candidate_output_is_truncated() -> None:
    from wh40kdc.data.loadout import loadout_candidates, validate_loadout

    models = [
        {
            "name": "Trooper",
            "min": 2,
            "max": 2,
            "loadout_variants": [
                {"name": "Rifle", "weapon_ids": ["rifle"]},
                {"name": "Plasma", "weapon_ids": ["plasma"], "max_count": 1},
            ],
        }
    ]
    assert loadout_candidates({"id": "u"}, 2, [], models, limit=0) == ["…truncated"]
    assert validate_loadout({"id": "u"}, 2, [], {"rifle": 1, "plasma": 1}, models) == []
    assert validate_loadout({"id": "u"}, 2, [], {"plasma": 2}, models)


def test_variant_validation_completes_sparse_defaults_but_rejects_full_conflicts() -> None:
    from wh40kdc.data.loadout import validate_loadout

    unit = {"id": "fabricated-unit", "weapon_ids": ["rifle"]}
    models = [
        {
            "name": "Trooper",
            "min": 2,
            "max": 2,
            "default_weapon_ids": ["rifle"],
            "loadout_variants": [
                {"name": "Rifle", "weapon_ids": ["rifle"]},
                {"name": "Plasma", "weapon_ids": ["plasma"], "max_count": 1},
            ],
        }
    ]

    assert validate_loadout(unit, 2, [], {"plasma": 1}, models) == []
    assert validate_loadout(unit, 2, [], {"rifle": 2, "plasma": 1}, models) == [
        {
            "id": "fabricated-unit",
            "code": "swap-conflict",
            "message": (
                "fabricated-unit: equipment cannot be assigned to legal whole-model loadouts"
            ),
        }
    ]


def test_variant_validation_reports_bounds_and_budgets_before_swap_conflict() -> None:
    from wh40kdc.data.loadout import validate_loadout

    unit = {
        "id": "fabricated-unit",
        "weapon_ids": ["rifle"],
        "wargear_budgets": [{"items": ["scanner"], "count": 1, "per_models": 0}],
    }
    models = [
        {
            "name": "Trooper",
            "min": 2,
            "max": 2,
            "default_weapon_ids": ["rifle"],
            "loadout_variants": [
                {"name": "Rifle", "weapon_ids": ["rifle"]},
                {"name": "Plasma", "weapon_ids": ["plasma"], "max_count": 1},
            ],
        }
    ]

    assert validate_loadout(unit, 2, [], {"plasma": 3, "scanner": 2}, models) == [
        {
            "id": "plasma",
            "code": "exceeds-max",
            "message": "plasma: 3 exceeds max 2",
        },
        {
            "id": "scanner",
            "code": "exceeds-allowance",
            "message": "scanner: 2 exceeds shared allowance 1 (1 per unit)",
        },
    ]


def test_candidate_limits_are_prefixes_of_canonical_traversal() -> None:
    from wh40kdc.data.loadout import loadout_candidates

    models = [
        {
            "name": "Trooper",
            "min": 2,
            "max": 2,
            "loadout_variants": [
                {"name": "Zulu", "weapon_ids": ["zulu"]},
                {"name": "Alpha", "weapon_ids": ["alpha"]},
                {"name": "Beta", "weapon_ids": ["beta"]},
            ],
        }
    ]
    tiers = [
        {"models": [{"name": "Trooper", "min": 2, "max": 2}]},
        {"models": [{"name": "Trooper", "min": 2, "max": 2}]},
    ]
    full = loadout_candidates({"id": "u"}, 2, [], models, tiers, limit=16)

    assert full[0] == "Zulu×2 => zulu:2"
    assert len(full) == 6
    for limit in (1, 2, 3):
        assert loadout_candidates({"id": "u"}, 2, [], models, tiers, limit=limit) == [
            *full[:limit],
            "…truncated",
        ]


def test_zero_candidate_limit_cancels_large_variant_search() -> None:
    from wh40kdc.data.loadout import loadout_candidates

    variants = [
        {
            "name": f"Variant {index:03d}",
            "weapon_ids": [f"weapon-{index}"],
        }
        for index in range(257)
    ]
    models = [
        {
            "name": "Trooper",
            "min": 5,
            "max": 5,
            "loadout_variants": variants,
        }
    ]

    assert loadout_candidates({"id": "u"}, 5, [], models, limit=0) == ["…truncated"]
