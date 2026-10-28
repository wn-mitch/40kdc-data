"""The expected-value damage engine and its buff layer."""

from wh40kdc.cruncher.allocation import (
    MAX_EVENT_WORK,
    AllocationDefences,
    AllocationOutput,
    DamageZeroing,
    allocate,
    allocate_model,
)
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
from wh40kdc.cruncher.granted_records import GrantedRecordLookup, resolve_granted_records

__all__ = [
    "ENGINE_DISPATCH_KEYWORDS",
    "MAX_EVENT_WORK",
    "AllocationDefences",
    "AllocationOutput",
    "AttackModel",
    "Buff",
    "BuffSource",
    "DamageZeroing",
    "EffectTranslation",
    "EngineContext",
    "EngineInput",
    "EngineOutput",
    "GrantedRecordLookup",
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
    "resolve_granted_records",
]
