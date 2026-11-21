"""Describer wording for a within check with models every (pinned against the TS reference)."""

from __future__ import annotations

from wh40kdc.translate import describe_condition


def test_objective_check_names_every_model_of_the_subject() -> None:
    every = {
        "type": "within",
        "parameters": {"of": {"objective": {}}, "range": "objective-control", "models": "every"},
    }
    assert (
        describe_condition(every)
        == "every model in this unit is within range of an objective marker"
    )
    plain = {
        "type": "within",
        "parameters": {"of": {"objective": {}}, "range": "objective-control"},
    }
    assert describe_condition(plain) == "this unit is within range of an objective marker"


def test_selected_objective_check_names_every_model_of_the_subject() -> None:
    selected = {
        "type": "within",
        "parameters": {
            "of": {"objective": {"selection_var": "marker"}},
            "range": "objective-control",
            "models": "every",
        },
    }
    assert (
        describe_condition(selected)
        == "every model in this unit is within range of that objective marker"
    )
