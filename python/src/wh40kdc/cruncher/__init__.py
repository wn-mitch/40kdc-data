"""The expected-value damage engine and its buff layer."""

from wh40kdc.cruncher.attribution import attribute_stages
from wh40kdc.cruncher.buffs import (
    Buff,
    BuffSource,
    EngineContext,
    ResolvedModifiers,
    resolve_buffs,
)
from wh40kdc.cruncher.engine import EngineInput, EngineOutput, crunch, eval_stat_value
from wh40kdc.cruncher.from_dsl import EffectTranslation, effect_to_buffs, parse_keyword_grant
from wh40kdc.cruncher.from_keyword import ENGINE_DISPATCH_KEYWORDS, buffs_from_keyword

__all__ = [
    "ENGINE_DISPATCH_KEYWORDS",
    "Buff",
    "BuffSource",
    "EffectTranslation",
    "EngineContext",
    "EngineInput",
    "EngineOutput",
    "ResolvedModifiers",
    "attribute_stages",
    "buffs_from_keyword",
    "crunch",
    "effect_to_buffs",
    "eval_stat_value",
    "parse_keyword_grant",
    "resolve_buffs",
]
