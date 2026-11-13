"""Linked, typed access to the embedded dataset."""

from wh40kdc.data.bundle import COLLECTION_KEYS, RawData, empty_raw_data, raw_data
from wh40kdc.data.collection import (
    DEFAULT_GAME_MODE,
    GAME_MODE_VIEWS,
    Collection,
    GameModeView,
    in_game_mode,
)
from wh40kdc.data.dataset import Dataset
from wh40kdc.data.entities import (
    AbilityView,
    FactionView,
    UnitView,
    WeaponKeywordView,
    WeaponView,
)
from wh40kdc.data.loadout import (
    base_loadout,
    check_unit_legality,
    clamp_weapon_count,
    loadout_candidates,
    maximal_loadout,
    option_cap,
    validate_loadout,
    weapon_bounds,
)
from wh40kdc.data.normalize import normalize_name
from wh40kdc.data.pricing import base_unit_points, points_tier_missing
from wh40kdc.data.unit_loadout import (
    UnitLoadout,
    mfm_group_row_order,
    mfm_groups,
    unit_loadout,
)

__all__ = [
    "COLLECTION_KEYS",
    "DEFAULT_GAME_MODE",
    "GAME_MODE_VIEWS",
    "AbilityView",
    "Collection",
    "Dataset",
    "FactionView",
    "GameModeView",
    "RawData",
    "UnitLoadout",
    "UnitView",
    "WeaponKeywordView",
    "WeaponView",
    "base_loadout",
    "base_unit_points",
    "check_unit_legality",
    "clamp_weapon_count",
    "empty_raw_data",
    "in_game_mode",
    "loadout_candidates",
    "maximal_loadout",
    "mfm_group_row_order",
    "mfm_groups",
    "normalize_name",
    "option_cap",
    "points_tier_missing",
    "raw_data",
    "unit_loadout",
    "validate_loadout",
    "weapon_bounds",
]
