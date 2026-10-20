"""The expected-value damage engine and its buff layer."""

from wh40kdc.cruncher.allocation import AllocationOutput, allocate, allocate_model
from wh40kdc.cruncher.attribution import attribute_stages
from wh40kdc.cruncher.buffs import (
    Buff,
    BuffSource,
    EngineContext,
    ResolvedModifiers,
    resolve_buffs,
)
from wh40kdc.cruncher.engine import (
    AttackModel,
    EngineInput,
    EngineOutput,
    crunch,
    crunch_model,
    eval_stat_value,
)
from wh40kdc.cruncher.from_dsl import EffectTranslation, effect_to_buffs
from wh40kdc.cruncher.from_keyword import ENGINE_DISPATCH_KEYWORDS, buffs_from_keyword

__all__ = [
    "ENGINE_DISPATCH_KEYWORDS",
    "AllocationOutput",
    "AttackModel",
    "Buff",
    "BuffSource",
    "EffectTranslation",
    "EngineContext",
    "EngineInput",
    "EngineOutput",
    "ResolvedModifiers",
    "allocate",
    "allocate_model",
    "attribute_stages",
    "buffs_from_keyword",
    "crunch",
    "crunch_model",
    "effect_to_buffs",
    "eval_stat_value",
    "resolve_buffs",
]
