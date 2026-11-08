"""Mortal wound sources a selection may count together."""

from wh40kdc.cruncher import mortal_wound_sources, within_choice_limits

_CHARGE = {"event": "move-ended", "filter": {"move_types": ["charge"]}}


def _select(count: int) -> dict[str, object]:
    return {
        "type": "select-units",
        "selector": {"filter": {"owner": "enemy"}, "count": {"min": 1, "max": 1}},
        "effect": {
            "type": "mortal-wounds",
            "target": "selected-unit",
            "modifier": {"count": count},
        },
    }


def _ids(sources: list[dict[str, object]]) -> list[object]:
    return [source["id"] for source in sources]


def test_a_choice_keeps_its_options_to_its_limit() -> None:
    effect = {"type": "choice", "options": [_select(1), _select(2)]}
    sources = mortal_wound_sources("x", effect, _CHARGE, {"phase": "shooting"})["sources"]
    assert _ids(within_choice_limits(sources)) == ["x?0"]
    assert _ids(within_choice_limits(list(reversed(sources)))) == ["x?1"]
    two = mortal_wound_sources("x", {**effect, "max_choices": 2}, _CHARGE, {"phase": "shooting"})
    assert _ids(within_choice_limits(two["sources"])) == ["x?0", "x?1"]


def test_sources_under_one_option_share_its_pick() -> None:
    effect = {
        "type": "choice",
        "options": [
            {
                "type": "sequence",
                "steps": [
                    _select(1),
                    {
                        "type": "ability-part",
                        "trigger": {"event": "phase-started", "filter": {"phase": "fight"}},
                        "effect": _select(2),
                    },
                ],
            },
            _select(3),
        ],
    }
    sources = mortal_wound_sources("x", effect, _CHARGE, {"phase": "shooting"})["sources"]
    assert [(source["id"], source["moment"]) for source in sources] == [
        ("x?0", "move-ended:charge"),
        ("x?0", "phase-started:fight"),
        ("x?1", "move-ended:charge"),
    ]
    assert len(within_choice_limits(sources)) == 2
