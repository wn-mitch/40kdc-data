"""Plain-English describers for the Ability DSL and scoring cards."""

from wh40kdc.translate.condition import Condition, dekebab, describe_condition
from wh40kdc.translate.effect import (
    Effect,
    describe_ability,
    describe_effect,
    describe_effect_inline,
    describe_scope,
)
from wh40kdc.translate.scoring import describe_award, describe_scoring_card, describe_trigger

__all__ = [
    "Condition",
    "Effect",
    "dekebab",
    "describe_ability",
    "describe_award",
    "describe_condition",
    "describe_effect",
    "describe_effect_inline",
    "describe_scope",
    "describe_scoring_card",
    "describe_trigger",
]
