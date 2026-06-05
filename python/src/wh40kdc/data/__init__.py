"""Linked, typed access to the embedded dataset."""

from wh40kdc.data.bundle import COLLECTION_KEYS, RawData, empty_raw_data, raw_data
from wh40kdc.data.collection import Collection
from wh40kdc.data.dataset import Dataset
from wh40kdc.data.entities import (
    AbilityView,
    FactionView,
    UnitView,
    WeaponKeywordView,
    WeaponView,
)
from wh40kdc.data.loadout import (
    clamp_weapon_count,
    maximal_loadout,
    option_cap,
    validate_loadout,
    weapon_bounds,
)
from wh40kdc.data.normalize import normalize_name

__all__ = [
    "COLLECTION_KEYS",
    "AbilityView",
    "Collection",
    "Dataset",
    "FactionView",
    "RawData",
    "UnitView",
    "WeaponKeywordView",
    "WeaponView",
    "clamp_weapon_count",
    "empty_raw_data",
    "maximal_loadout",
    "normalize_name",
    "option_cap",
    "raw_data",
    "validate_loadout",
    "weapon_bounds",
]
