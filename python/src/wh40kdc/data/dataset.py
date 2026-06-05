"""``Dataset`` ties the embedded records together.

It owns every :class:`~wh40kdc.data.collection.Collection`, builds the
cross-entity indexes once, and is the hub the linked views resolve against.

Python mirror of ``tools/src/data/dataset.ts``.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.data.bundle import RawData, empty_raw_data, raw_data
from wh40kdc.data.collection import Collection, id_collection
from wh40kdc.data.entities import (
    AbilityView,
    FactionView,
    UnitView,
    WeaponKeywordView,
    WeaponView,
)


def _buff_source_from_eligible(entry: dict[str, Any]) -> dict[str, Any]:
    """Map an eligible-ability entry back to the BuffSource the translator
    expects."""
    ability_id = entry["ability"].id
    kind = entry["source"]["kind"]
    if kind == "attached":
        return {
            "kind": "ability",
            "abilityId": ability_id,
            "abilityKind": "attached",
            "sourceUnitId": entry["source"]["unitId"],
        }
    if kind == "detachment-stratagem":
        ability_kind = "detachment-stratagem"
    else:
        ability_kind = kind  # army / detachment / unit / support
    return {"kind": "ability", "abilityId": ability_id, "abilityKind": ability_kind}


class Dataset:
    """The whole dataset, with linked accessors over every entity collection."""

    def __init__(self, raw: RawData | None = None) -> None:
        if raw is None:
            raw = empty_raw_data()

        # Richly-linked collections.
        self.units: Collection[dict[str, Any], UnitView] = Collection(
            raw["units"],
            id_of=lambda u: u["id"],
            # The same unit id is shared across factions (e.g.
            # ministorum-priest); keep each faction's copy, collapse only true
            # within-faction duplicates.
            dedupe_key_of=lambda u: f"{u['faction_id']}::{u['id']}",
            name_of=lambda u: u.get("name"),
            faction_of=lambda u: u.get("faction_id"),
            wrap=lambda u: UnitView(u, self),
        )
        self.weapons: Collection[dict[str, Any], WeaponView] = Collection(
            raw["weapons"],
            id_of=lambda w: w["id"],
            name_of=lambda w: w.get("name"),
            wrap=lambda w: WeaponView(w, self),
        )
        self.weapon_keywords: Collection[dict[str, Any], WeaponKeywordView] = Collection(
            raw["weapon_keywords"],
            id_of=lambda k: k["id"],
            name_of=lambda k: k.get("name"),
            wrap=lambda k: WeaponKeywordView(k, self),
        )
        self.factions: Collection[dict[str, Any], FactionView] = Collection(
            raw["factions"],
            id_of=lambda f: f["id"],
            name_of=lambda f: f.get("name"),
            wrap=lambda f: FactionView(f, self),
        )
        self.abilities: Collection[dict[str, Any], AbilityView] = Collection(
            raw["abilities"],
            id_of=lambda a: a["ability_id"],
            name_of=lambda a: a.get("name"),
            faction_of=lambda a: a.get("faction_id"),
            wrap=lambda a: AbilityView(a, self),
        )

        # Id-bearing collections without bespoke views (records returned as-is).
        self.detachments = id_collection(raw["detachments"], lambda d: d.get("faction_id"))
        self.enhancements = id_collection(raw["enhancements"])
        self.stratagems = id_collection(raw["stratagems"])
        self.wargear_options = id_collection(raw["wargear_options"])
        self.wargear = id_collection(raw["wargear"])
        self.missions = id_collection(raw["missions"])
        self.mission_matchups = id_collection(raw["mission_matchups"])
        self.mission_cards = id_collection(raw["mission_cards"])
        self.deployment_patterns = id_collection(raw["deployment_patterns"])
        self.force_dispositions = id_collection(raw["force_dispositions"])
        self.terrain_templates = id_collection(raw["terrain_templates"])
        self.terrain_layouts = id_collection(raw["terrain_layouts"])
        self.resource_pools = id_collection(raw["resource_pools"])

        # Id-less collections, exposed as plain lists.
        self.leader_attachments: list[dict[str, Any]] = raw["leader_attachments"]
        self.unit_compositions: list[dict[str, Any]] = raw["unit_compositions"]
        self.game_versions: list[dict[str, Any]] = raw["game_versions"]
        self.timing_flags: list[dict[str, Any]] = raw["timing_flags"]
        self.interaction_flags: list[dict[str, Any]] = raw["interaction_flags"]
        self.phase_mappings: list[dict[str, Any]] = raw["phase_mappings"]

        # `source_type:source_id` → unioned phases.
        self._phase_index: dict[str, list[str]] = {}
        # ability id → units that list it.
        self._units_by_ability: dict[str, list[dict[str, Any]]] = {}
        # weapon id → units that list it.
        self._units_by_weapon: dict[str, list[dict[str, Any]]] = {}
        # weapon-keyword id → weapons whose profiles reference it.
        self._weapons_by_keyword: dict[str, list[dict[str, Any]]] = {}
        # unit id → wargear options authored for it (declared order preserved).
        self._wargear_options_by_unit: dict[str, list[dict[str, Any]]] = {}

        self._build_indexes(raw)

    @staticmethod
    def embedded() -> Dataset:
        """The dataset built from the package's embedded data."""
        return Dataset(raw_data())

    def phases_for(self, source_type: str, source_id: str) -> list[str]:
        """Phases a source acts in, unioned across its phase-mappings."""
        return self._phase_index.get(f"{source_type}:{source_id}", [])

    def resolve_terrain(self, layout: dict[str, Any]) -> list[dict[str, Any]]:
        """Resolve a terrain layout to absolute board-space vertices.

        Uses this dataset's embedded terrain-template catalog — the layout-id →
        renderable-geometry hop. The geometry is pinned by the
        ``terrain-resolver`` conformance corpus.
        """
        from wh40kdc.terrain.resolve import resolve_layout

        return resolve_layout(layout, self.terrain_templates.all)

    def recommended_terrain_layouts(self, pattern: dict[str, Any]) -> list[dict[str, Any]]:
        """The terrain layouts a deployment pattern recommends, in declared order.

        Skips any ids absent from the dataset.
        """
        out = []
        for id_ in pattern.get("recommended_terrain_layout_ids") or []:
            layout = self.terrain_layouts.get(id_)
            if layout is not None:
                out.append(layout)
        return out

    def units_with_ability(self, ability_id: str) -> list[UnitView]:
        """Units that list the given ability id."""
        return [UnitView(u, self) for u in self._units_by_ability.get(ability_id, [])]

    def units_with_weapon(self, weapon_id: str) -> list[UnitView]:
        """Units that list the given weapon id."""
        return [UnitView(u, self) for u in self._units_by_weapon.get(weapon_id, [])]

    def weapons_with_keyword(self, keyword_id: str) -> list[WeaponView]:
        """Weapons whose profiles reference the given weapon-keyword id."""
        return [WeaponView(w, self) for w in self._weapons_by_keyword.get(keyword_id, [])]

    def wargear_options_of(self, unit: dict[str, Any]) -> list[dict[str, Any]]:
        """Wargear options authored for the given unit, in declared order.

        Empty for a unit with no options.
        """
        return self._wargear_options_by_unit.get(unit["id"], [])

    def leaders_attachable_to(self, bodyguard_unit_id: str) -> list[UnitView]:
        """Leaders whose leader-attachment data lists the unit among its bodyguards.

        The attachment is stored on the leader pointing down to its bodyguards,
        so answering "which leaders can attach to this unit?" means scanning
        the attachment list. Sorted by name. Empty for a unit that no leader
        can attach to (including leader units).
        """
        out = []
        for la in self.leader_attachments:
            if bodyguard_unit_id not in la.get("eligible_bodyguard_ids", []):
                continue
            unit = self.units.get(la["leader_id"])
            if unit is not None:
                out.append(unit)
        return sorted(out, key=lambda u: u.name)

    def bodyguards_attachable_from(self, leader_unit_id: str) -> list[UnitView]:
        """The inverse of :meth:`leaders_attachable_to`, deduped by id, sorted by name.

        Empty for a non-leader unit.
        """
        seen: set[str] = set()
        out: list[UnitView] = []
        for la in self.leader_attachments:
            if la.get("leader_id") != leader_unit_id:
                continue
            for bodyguard_id in la.get("eligible_bodyguard_ids", []):
                if bodyguard_id in seen:
                    continue
                unit = self.units.get(bodyguard_id)
                if unit is None:
                    continue
                seen.add(bodyguard_id)
                out.append(unit)
        return sorted(out, key=lambda u: u.name)

    def eligible_abilities(self, input: dict[str, Any], phase: str) -> list[dict[str, Any]]:
        """Every ability that could apply to the given unit in ``phase``, by source."""
        from wh40kdc.abilities_resolver import resolve_eligible_abilities

        return resolve_eligible_abilities(self, input, phase)

    def buffs_for(self, input: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
        """Attacker-perspective buff stack for a (unit, phase) combination.

        Intrinsic weapon-profile keywords plus every eligible ability whose
        DSL effect translates to an attacker-side buff. Only buffs the buff
        layer can express are included — the ``unsupported`` half of the
        translation is dropped here.
        """
        return self._collect_buffs(input, context, "attacker")

    def defensive_buffs_for(
        self, input: dict[str, Any], context: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """Defender-perspective buff stack: walks the same eligible-abilities
        set as :meth:`buffs_for` but translates each ability's DSL effect as
        defensive (FNP, save/toughness mods, save rerolls, incoming hit
        penalties). ``weaponProfiles`` are ignored under target perspective."""
        return self._collect_buffs(input, context, "target")

    def stackable_buffs_for(
        self, input: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        """Enumerate every attacker-side buff a unit could stack in
        ``context`` as toggleable levers plus their activation groups.

        Unlike :meth:`buffs_for` — which returns only the buffs that
        auto-apply — this surfaces the *player decisions* too: stratagems and
        the activatable gates the DSL models as dice-pool options, ``choice``
        branches, or timing-gated activations. Returns
        ``{"buffs": [StackableBuff], "groups": [StackableBuffGroup]}``.
        """
        buffs: list[dict[str, Any]] = []
        groups: dict[str, dict[str, Any]] = {}
        ctx = self._derived_context(input, context)

        # Intrinsic weapon-profile keywords — always on.
        for ref in input.get("weaponProfiles") or []:
            weapon = self.weapons.get(ref["weaponId"])
            if weapon is None:
                continue
            wk = weapon.profile_buffs(ref.get("profileIndex"), ctx)
            if not wk:
                continue
            buffs.append(
                {
                    "id": f"weapon:{ref['weaponId']}:{ref['profileIndex']}",
                    "label": f"{weapon.name} keywords",
                    "buffs": wk,
                    "enabled": True,
                    "source": wk[0]["source"],
                }
            )

        for entry in self.eligible_abilities(input, ctx["phase"]):
            source = _buff_source_from_eligible(entry)
            translation = entry["ability"].describe_buffs(source, ctx, "attacker")
            # Stratagems cost CP — opt-in, not on by default.
            is_stratagem = entry["source"]["kind"] == "detachment-stratagem"

            if translation["applied"]:
                buffs.append(
                    {
                        "id": f"{entry['source']['kind']}:{entry['ability'].id}",
                        "label": entry["ability"].name,
                        "buffs": translation["applied"],
                        "enabled": not is_stratagem,
                        "source": source,
                    }
                )

            for act in translation["activatable"]:
                group_id = None
                if act.get("group"):
                    group_id = act["group"]["id"]
                    if group_id not in groups:
                        groups[group_id] = {
                            "id": group_id,
                            "label": entry["ability"].name,
                            "maxActivations": act["group"]["maxActivations"],
                        }
                lever = {
                    "id": act["id"],
                    "label": f"{entry['ability'].name} — {act['label']}",
                    "buffs": act["buffs"],
                    "enabled": False,
                    "source": source,
                }
                if group_id is not None:
                    lever["group"] = group_id
                buffs.append(lever)

        return {"buffs": buffs, "groups": list(groups.values())}

    def _derived_context(
        self, input: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        """Clone the caller's context, deriving ``attackerAttached`` from a
        non-empty ``attachedUnitIds`` when not explicitly set."""
        ctx = dict(context)
        if ctx.get("attackerAttached") is None:
            ctx["attackerAttached"] = bool(input.get("attachedUnitIds"))
        return ctx

    def _collect_buffs(
        self, input: dict[str, Any], context: dict[str, Any], perspective: str
    ) -> list[dict[str, Any]]:
        """Shared implementation for buffs_for / defensive_buffs_for."""
        out: list[dict[str, Any]] = []
        ctx = self._derived_context(input, context)

        # Weapon-profile keywords are attacker-only.
        if perspective == "attacker":
            for ref in input.get("weaponProfiles") or []:
                weapon = self.weapons.get(ref["weaponId"])
                if weapon is None:
                    continue
                out.extend(weapon.profile_buffs(ref.get("profileIndex"), ctx))

        opted_in = set(input.get("optedInStratagemIds") or [])
        for entry in self.eligible_abilities(input, ctx["phase"]):
            source_info = entry["source"]
            if (
                source_info["kind"] == "detachment-stratagem"
                and source_info["stratagemId"] not in opted_in
            ):
                continue
            source = _buff_source_from_eligible(entry)
            out.extend(entry["ability"].get_buffs(source, ctx, perspective))

        return out

    def _build_indexes(self, raw: RawData) -> None:
        for pm in raw["phase_mappings"]:
            key = f"{pm['source_type']}:{pm['source_id']}"
            existing = self._phase_index.setdefault(key, [])
            for phase in pm["phases"]:
                if phase not in existing:
                    existing.append(phase)
        for unit in raw["units"]:
            for ability_id in unit.get("ability_ids") or []:
                self._units_by_ability.setdefault(ability_id, []).append(unit)
            for weapon_id in unit.get("weapon_ids") or []:
                self._units_by_weapon.setdefault(weapon_id, []).append(unit)
        for option in raw["wargear_options"]:
            self._wargear_options_by_unit.setdefault(option["unit_id"], []).append(option)
        seen_by_keyword: dict[str, set[str]] = {}
        for weapon in raw["weapons"]:
            for profile in weapon["profiles"]:
                for ref in profile.get("keywords") or []:
                    seen = seen_by_keyword.setdefault(ref["keyword_id"], set())
                    if weapon["id"] in seen:
                        continue
                    seen.add(weapon["id"])
                    self._weapons_by_keyword.setdefault(ref["keyword_id"], []).append(weapon)
