"""Complementary re-roll pairs under an undecided condition apply the weaker re-roll.

Mirrors the TS ``complementaryFloors`` rule in ``tools/src/cruncher/from-dsl.ts``: "re-roll a
Hit roll of 1; while within 6" of Battleline, re-roll the Hit roll instead" compiles to
``not C: re-roll 1s`` and ``C: re-roll all``. One branch always applies, so without board state
the re-roll of 1s does and the full re-roll is reported as needing ``C``.
"""

from __future__ import annotations

from typing import Any

import pytest

BREACHING_COMMAND = "breaching-command-adeptus-mechanicus"


@pytest.fixture(scope="module")
def breaching_command(dataset: Any) -> Any:
    ability = dataset.abilities.get_in_faction(BREACHING_COMMAND, "adeptus-mechanicus")
    assert ability is not None
    return ability


def _source(ability: Any) -> dict[str, Any]:
    return {"kind": "ability", "abilityId": ability.id, "abilityKind": "unit"}


def test_applies_the_weaker_re_roll_without_board_state(breaching_command: Any) -> None:
    out = breaching_command.describe_buffs(
        _source(breaching_command), {"phase": "shooting"}, "attacker"
    )
    assert [buff["contribution"] for buff in out["applied"]] == [
        {"type": "reroll", "roll": "hit", "subset": "ones"}
    ]
    assert [item["reason"] for item in out["unsupported"]] == [
        'conditional: cannot evaluate condition "matches" against current context; '
        "the weaker re-roll of its complementary pair applies"
    ]
    assert out["unsupported"][0]["needs"], "the stronger re-roll names the condition it needs"


def test_applies_the_full_re_roll_with_a_battleline_neighbour(breaching_command: Any) -> None:
    ctx = {
        "phase": "shooting",
        "attackerNeighbours": [
            {
                "keywords": ["ADEPTUS MECHANICUS", "BATTLELINE"],
                "owner": "friendly",
                "distanceInches": 3,
            }
        ],
    }
    out = breaching_command.describe_buffs(_source(breaching_command), ctx, "attacker")
    assert [buff["contribution"] for buff in out["applied"]] == [
        {"type": "reroll", "roll": "hit", "subset": "all-failures"}
    ]
    assert out["unsupported"] == []
