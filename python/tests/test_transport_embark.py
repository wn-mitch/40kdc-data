"""Describer wording for eligible to embark within a named Transport (pinned against the TS reference)."""

from __future__ import annotations

from wh40kdc.translate import describe_condition


def test_embark_within_reads_the_subject_able_to_embark_within_the_transport() -> None:
    condition = {
        "type": "eligible",
        "parameters": {"subject": "this-unit", "to": "embark-within", "transport": "ability-unit"},
    }
    assert describe_condition(condition) == "the unit is able to embark within this unit"


def test_embark_within_negated_by_the_not_operator() -> None:
    condition = {
        "operator": "not",
        "operands": [
            {"type": "eligible", "parameters": {"subject": "this-unit", "to": "embark-within", "transport": "this-unit"}}
        ],
    }
    assert describe_condition(condition) == "the unit is not able to embark within that Transport"
