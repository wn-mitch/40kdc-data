"""The flat ``Buff`` shape every contribution flows through, and the
:func:`resolve_buffs` resolver that collapses a stack into a resolved-modifiers
read-out the engine can consume.

The same shape carries weapon-keyword effects, ability buffs, stratagem
effects, and manual UI toggles — reroll-stacking, hit/wound caps, and
feel-no-pain-best-threshold all fall out of one resolver rather than each
source kind reinventing precedence.

Buffs are plain dicts mirroring the wire shape::

    {"source": {...}, "contribution": {...}, "applicableWhen": {...}?}

Python mirror of ``tools/src/cruncher/buffs.ts``. The resolved-modifiers dict
keeps the TS camelCase field names so the port stays line-comparable.
"""

from __future__ import annotations

import json
from typing import Any

from wh40kdc.cruncher.scenario_conditions import attack_comparisons_hold

Buff = dict[str, Any]
BuffSource = dict[str, Any]
ResolvedModifiers = dict[str, Any]
#: The engine context (TS ``EngineContext``). Beyond phase/timing/attacker state it may carry
#: ``armyFaction`` (Army Faction id), ``targetArmyFaction`` (the defending army's),
#: ``battleSize`` (``incursion`` / ``strike-force`` /
#: ``onslaught``), ``attackerGuided`` (the attacker is Guided) and ``attackerModelCount`` /
#: ``targetModelCount`` (models in each unit, for ``model-count``) and ``attackerWargear`` /
#: ``targetWargear`` (complete maps of wargear id to the models of the chosen loadout carrying
#: it, for ``unit-wargear``; an attached unit's sums every member's loadout, core rule 19.01);
#: each drives its condition
#: and leaves it "unknown" when absent. ``weaponNames`` (lower-cased names of the attacking
#: weapon and its profile) drives ``applicableWhen.weaponName``; absent leaves weapon-name gates
#: permissive. ``weaponKeywords`` (catalog keyword ids printed on the attacking profile) drives
#: ``applicableWhen.weaponKeyword`` together with keywords live buffs grant; absent leaves
#: weapon-keyword gates permissive.
#:
#: Scenario state, each left "unknown" by its condition or filter when absent:
#: ``battleRound`` (``battle-round``, per-round range tables); ``attackerTurn`` (it is the
#: attacking unit's player's turn, for ``player-turn-is`` read from the ability's side);
#: ``attackerStrength`` / ``targetStrength`` (``full`` / ``below-starting`` / ``below-half``,
#: for ``strength``); ``attackerWounds`` / ``targetWounds`` (``{remaining, starting}`` of the
#: damaged or only model, for ``wounds``); ``attackerDesignations`` / ``targetDesignations``
#: (complete designation lists, matched case-insensitively by ``designated`` filters);
#: ``attackerStates`` / ``targetStates`` (complete lists of ``engaged`` / ``battle-shocked`` /
#: ``hidden``); ``targetClosest`` (the target is the closest eligible target, for
#: ``closest``); ``attackerObjectives`` / ``targetObjectives`` (complete lists of objectives
#: in control range, each ``{controller?, designations?, role?, homeOf?, territory?, name?}``
#: with ``controller`` / ``homeOf`` / ``territory`` read from the attacking unit's player as
#: ``attacker`` / ``target`` (plus ``none`` / ``no-mans-land``)). The attack's characteristics,
#: neighbours, active rules, regions, objective counts and combined-unit members are listed in
#: :mod:`wh40kdc.cruncher.scenario_conditions`.
EngineContext = dict[str, Any]

#: Stable ordering used to break ties when multiple buffs claim the same field.
_SOURCE_KIND_RANK = {
    "ability:army": 0,
    "ability:detachment": 1,
    "ability:detachment-stratagem": 2,
    "ability:unit": 3,
    "ability:attached": 4,
    "ability:support": 5,
    "manual": 6,
    "weapon-keyword": 7,
}


def _rank(s: BuffSource) -> int:
    if s.get("kind") == "ability":
        return _SOURCE_KIND_RANK.get(f"ability:{s.get('abilityKind')}", 99)
    return _SOURCE_KIND_RANK.get(s.get("kind", ""), 99)


def _keyword_ref_matches(actual: dict[str, Any], selector: dict[str, Any]) -> bool:
    if actual.get("keyword_id") != selector.get("keyword_id"):
        return False
    actual_params = actual.get("parameters")
    if not isinstance(actual_params, dict):
        actual_params = {}
    expected_params = selector.get("parameters")
    if not isinstance(expected_params, dict):
        expected_params = {}
    for key, expected in expected_params.items():
        value = actual_params.get(key)
        if isinstance(expected, str) and isinstance(value, str) and key == "target_keyword":
            if expected.lower() != value.lower():
                return False
        elif isinstance(expected, list):
            if not isinstance(value, list) or len(value) != len(expected):
                return False
            if not all(
                isinstance(item, str)
                and any(
                    isinstance(candidate, str) and item.lower() == candidate.lower()
                    for candidate in value
                )
                for item in expected
            ):
                return False
        elif value != expected:
            return False
    return True


def _weapon_gate_holds(
    gate: dict[str, Any], refs: list[dict[str, Any]] | None, ctx: EngineContext
) -> bool:
    weapon_names = ctx.get("weaponNames")
    if gate.get("weaponName") is not None and gate["weaponName"] not in (weapon_names or []):
        return False
    if gate.get("excludedWeaponNames") and (
        weapon_names is None or any(name in weapon_names for name in gate["excludedWeaponNames"])
    ):
        return False
    requirements = gate.get("weaponRequirements") or []
    if any(not _weapon_gate_holds(req, refs, ctx) for req in requirements):
        return False
    if not attack_comparisons_hold(gate, ctx):
        return False
    selectors = gate.get("weaponKeywords")
    if selectors is not None:
        if refs is None or not any(
            _keyword_ref_matches(ref, selector) for selector in selectors for ref in refs
        ):
            return False
    exclusions = gate.get("excludedWeaponKeywords")
    if exclusions is not None:
        if refs is None:
            return False
        for selector in exclusions:
            if any(
                ref.get("keyword_id") == selector.get("keyword_id")
                and any(
                    key not in (ref.get("parameters") or {})
                    for key in (selector.get("parameters") or {})
                )
                for ref in refs
            ):
                return False
            if any(_keyword_ref_matches(ref, selector) for ref in refs):
                return False
    return True


def _applies(buff: Buff, ctx: EngineContext) -> bool:
    w = buff.get("applicableWhen")
    if not w:
        return True
    if w.get("onCritical") is not None and ctx.get("criticalRoll") != w["onCritical"]:
        return False
    phases = w.get("phases")
    if phases and ctx.get("phase") not in phases:
        return False
    contribution = buff["contribution"]
    if (
        w.get("rollType")
        and contribution.get("type") in ("reroll", "reroll-one")
        and contribution.get("roll") != w["rollType"]
    ):
        return False
    if w.get("requiresTargetKeyword"):
        target = ctx.get("targetKeywords") or []
        if w["requiresTargetKeyword"].lower() not in target:
            return False
    excluded = w.get("excludedTargetKeywords")
    target_keywords = ctx.get("targetKeywords")
    if excluded and target_keywords is not None:
        if any(keyword.lower() in target_keywords for keyword in excluded):
            return False
    if w.get("requiresAttackerKeyword"):
        attacker = ctx.get("attackerKeywords") or []
        if w["requiresAttackerKeyword"].lower() not in attacker:
            return False
    max_range = w.get("maxRangeInches")
    distance = ctx.get("distanceInches")
    if max_range is not None:
        if (
            not isinstance(distance, (int, float))
            or isinstance(distance, bool)
            or distance > max_range
        ):
            return False
    weapon_name = w.get("weaponName")
    weapon_names = ctx.get("weaponNames")
    if weapon_name is not None and weapon_names is not None and weapon_name not in weapon_names:
        return False
    excluded_names = w.get("excludedWeaponNames")
    if (
        excluded_names
        and weapon_names is not None
        and any(name in weapon_names for name in excluded_names)
    ):
        return False
    weapon_keywords = ctx.get("weaponKeywords")
    any_keywords = w.get("weaponKeywordsAny")
    if (
        any_keywords
        and weapon_keywords is not None
        and not any(k in weapon_keywords for k in any_keywords)
    ):
        return False
    excluded_weapon_keywords = w.get("excludedWeaponKeywords")
    if (
        excluded_weapon_keywords
        and weapon_keywords is not None
        and any(k in weapon_keywords for k in excluded_weapon_keywords)
    ):
        return False
    return attack_comparisons_hold(w, ctx)


def _live_buffs(buffs: list[Buff], ctx: EngineContext) -> list[Buff]:
    """Resolve weapon gates while preserving structured keyword ratings."""
    printed = ctx.get("weaponKeywordRefs")
    if printed is None and ctx.get("weaponKeywords") is not None:
        printed = [{"keyword_id": keyword} for keyword in ctx["weaponKeywords"]]

    def gated(buff: Buff) -> bool:
        gate = buff.get("applicableWhen") or {}
        return any(
            gate.get(key) is not None
            for key in (
                "weaponKeyword",
                "weaponKeywords",
                "excludedWeaponKeywords",
                "weaponRequirements",
            )
        )

    base = [buff for buff in buffs if _applies(buff, ctx)]
    selected: list[Buff] = [buff for buff in base if not gated(buff)]
    pending = [buff for buff in base if gated(buff)]
    while True:
        refs = list(printed) if printed is not None else None
        if refs is not None:
            refs.extend(
                buff["contribution"]["keywordRef"]
                for buff in selected
                if buff["contribution"].get("type") == "extra-keyword"
            )
        next_buffs = [
            buff
            for buff in pending
            if _weapon_gate_holds(buff.get("applicableWhen") or {}, refs, ctx)
        ]
        if not next_buffs:
            break
        selected.extend(next_buffs)
        pending = [buff for buff in pending if buff not in next_buffs]
    return [buff for buff in buffs if buff in selected]


def _key_of(ref: dict[str, Any]) -> str:
    return f"{ref.get('keyword_id')}::{json.dumps(ref.get('parameters') or {})}"


def resolve_buffs(buffs: list[Buff], ctx: EngineContext) -> ResolvedModifiers:
    """Collapse a flat buff stack into a resolved-modifiers read-out.

    Pure function; the engine — and any UI that wants to render the resolved
    table before crunching — both go through this.
    """
    live = _live_buffs(buffs, ctx)

    out: ResolvedModifiers = {
        "hitMod": {"value": 0, "dominantSource": None},
        "woundMod": {"value": 0, "dominantSource": None},
        "saveMod": {"value": 0, "sources": []},
        "cover": {"active": False, "source": None},
        "rerolls": {},
        # One re-rolled die per roll, from a `reroll-one`; several sources still give one die.
        "rerollOne": {},
        "extraKeywords": [],
        "feelNoPain": None,
        "feelNoPainMortal": None,
        "damageMod": {"value": 0, "sources": []},
        "attacksMod": {"value": 0, "sources": []},
        "strengthMod": {"value": 0, "sources": []},
        "toughnessMod": {"value": 0, "sources": []},
        "apMod": {"value": 0, "sources": []},
        "statSet": {},
        "damageReduction": {"value": 0, "dominantSource": None},
        # Damage-zeroing uses, summed over sources: a pool the unit shares and uses per model.
        "damageZeroing": {"unit": 0, "model": 0, "sources": []},
        "invulnerable": None,
        # Lowest critical threshold granted per roll; absent rolls crit on a 6.
        "critThresholds": {},
        # Rolls whose negative modifiers the attacker ignores.
        "ignoreModifiers": {},
        # Summed WS/BS characteristic improvements.
        "skillMod": {"WS": {"value": 0, "sources": []}, "BS": {"value": 0, "sources": []}},
        # Ability-set Save characteristic; None keeps the printed one.
        "saveCharacteristic": None,
        # Summed capped Save improvements; "best" is the most restrictive (largest) cap. None
        # when none applies.
        "saveImprove": None,
    }

    # Hit / wound mods: sum, then cap at ±1, with dominant source picked from
    # the contributors whose sign matches the surviving value.
    hit_contribs: list[dict[str, Any]] = []
    wound_contribs: list[dict[str, Any]] = []

    for b in live:
        c = b["contribution"]
        ctype = c.get("type")
        source = b["source"]
        if ctype == "hit-mod":
            hit_contribs.append({"value": c["value"], "source": source})
        elif ctype == "wound-mod":
            wound_contribs.append({"value": c["value"], "source": source})
        elif ctype == "save-mod":
            out["saveMod"]["value"] += c["value"]
            out["saveMod"]["sources"].append(source)
        elif ctype == "cover":
            if not out["cover"]["active"] or _rank(source) < _rank(out["cover"]["source"]):
                out["cover"] = {"active": True, "source": source}
        elif ctype == "reroll":
            cur = out["rerolls"].get(c["roll"])
            incoming = c["subset"]
            if cur is None:
                out["rerolls"][c["roll"]] = {"subset": incoming, "dominantSource": source}
            else:
                incoming_stronger = (incoming == "all-failures" and cur["subset"] == "ones") or (
                    incoming == cur["subset"] and _rank(source) < _rank(cur["dominantSource"])
                )
                if incoming_stronger:
                    out["rerolls"][c["roll"]] = {"subset": incoming, "dominantSource": source}
        elif ctype == "reroll-one":
            cur = out["rerollOne"].get(c["roll"])
            if cur is None or _rank(source) < _rank(cur["dominantSource"]):
                out["rerollOne"][c["roll"]] = {"dominantSource": source}
        elif ctype == "extra-keyword":
            key = _key_of(c["keywordRef"])
            if not any(_key_of(e["keywordRef"]) == key for e in out["extraKeywords"]):
                out["extraKeywords"].append({"keywordRef": c["keywordRef"], "source": source})
        elif ctype == "feel-no-pain":
            # Best (lowest) threshold wins per scope. An undeclared scope is
            # treated as "all" — unscoped FNP applies to every wound.
            scope = c.get("scope", "all")
            slot = "feelNoPainMortal" if scope == "mortal" else "feelNoPain"
            if out[slot] is None or c["threshold"] < out[slot]["threshold"]:
                out[slot] = {"threshold": c["threshold"], "dominantSource": source}
        elif ctype == "damage-mod":
            out["damageMod"]["value"] += c["value"]
            out["damageMod"]["sources"].append(source)
        elif ctype == "attacks-mod":
            out["attacksMod"]["value"] += c["value"]
            out["attacksMod"]["sources"].append(source)
        elif ctype == "strength-mod":
            out["strengthMod"]["value"] += c["value"]
            out["strengthMod"]["sources"].append(source)
        elif ctype == "toughness-mod":
            out["toughnessMod"]["value"] += c["value"]
            out["toughnessMod"]["sources"].append(source)
        elif ctype == "ap-mod":
            out["apMod"]["value"] += c["value"]
            out["apMod"]["sources"].append(source)
        elif ctype == "damage-reduction":
            # Highest reduction wins (no stacking). Ties break by source rank
            # for provenance; the resolved value is unchanged either way.
            dr = out["damageReduction"]
            if (
                dr["dominantSource"] is None
                or c["value"] > dr["value"]
                or (c["value"] == dr["value"] and _rank(source) < _rank(dr["dominantSource"]))
            ):
                out["damageReduction"] = {"value": c["value"], "dominantSource": source}
        elif ctype == "damage-zeroing":
            out["damageZeroing"][c["per"]] += c["uses"]
            out["damageZeroing"]["sources"].append(source)
        elif ctype == "invulnerable-save":
            # Best (lowest threshold) wins. Same tie-break by source rank.
            inv = out["invulnerable"]
            if (
                inv is None
                or c["threshold"] < inv["threshold"]
                or (
                    c["threshold"] == inv["threshold"]
                    and _rank(source) < _rank(inv["dominantSource"])
                )
            ):
                out["invulnerable"] = {"threshold": c["threshold"], "dominantSource": source}
        elif ctype == "crit-threshold":
            cur = out["critThresholds"].get(c["roll"])
            if (
                cur is None
                or c["value"] < cur["value"]
                or (c["value"] == cur["value"] and _rank(source) < _rank(cur["dominantSource"]))
            ):
                out["critThresholds"][c["roll"]] = {"value": c["value"], "dominantSource": source}
        elif ctype == "ignore-modifiers":
            cur = out["ignoreModifiers"].get(c["roll"])
            if cur is None or _rank(source) < _rank(cur["dominantSource"]):
                out["ignoreModifiers"][c["roll"]] = {"dominantSource": source}
        elif ctype == "skill-mod":
            out["skillMod"][c["stat"]]["value"] += c["value"]
            out["skillMod"][c["stat"]]["sources"].append(source)
        elif ctype == "save-characteristic":
            sc = out["saveCharacteristic"]
            if (
                sc is None
                or c["value"] < sc["value"]
                or (c["value"] == sc["value"] and _rank(source) < _rank(sc["dominantSource"]))
            ):
                out["saveCharacteristic"] = {"value": c["value"], "dominantSource": source}
        elif ctype == "stat-set":
            # The best set wins for the attacker: the highest A, S or D, the most negative AP.
            cur = out["statSet"].get(c["stat"])
            better = cur is None or (
                c["value"] < cur["value"] if c["stat"] == "AP" else c["value"] > cur["value"]
            )
            if better or (
                c["value"] == cur["value"] and _rank(source) < _rank(cur["dominantSource"])
            ):
                out["statSet"][c["stat"]] = {"value": c["value"], "dominantSource": source}
        elif ctype == "save-improve":
            si = out["saveImprove"]
            if si is None:
                out["saveImprove"] = {"value": c["value"], "best": c["best"], "sources": [source]}
            else:
                si["value"] += c["value"]
                si["best"] = max(si["best"], c["best"])
                si["sources"].append(source)

    # An ignored roll keeps only its positive modifiers.
    def kept(contribs: list[dict[str, Any]], ignored: bool) -> list[dict[str, Any]]:
        return [c for c in contribs if c["value"] > 0] if ignored else contribs

    out["hitMod"] = _cap_modifier(kept(hit_contribs, "hit" in out["ignoreModifiers"]))
    out["woundMod"] = _cap_modifier(kept(wound_contribs, "wound" in out["ignoreModifiers"]))

    return out


def _sign(n: float) -> int:
    return (n > 0) - (n < 0)


def _cap_modifier(contribs: list[dict[str, Any]]) -> dict[str, Any]:
    """Sum, clamp to ±1, then pick the dominant contributing source by rank."""
    if not contribs:
        return {"value": 0, "dominantSource": None}
    total = sum(c["value"] for c in contribs)
    capped = max(-1, min(1, total))
    if capped == 0:
        return {"value": 0, "dominantSource": None}
    sign = _sign(capped)
    matching = sorted(
        (c for c in contribs if _sign(c["value"]) == sign),
        key=lambda c: _rank(c["source"]),
    )
    return {
        "value": capped,
        "dominantSource": matching[0]["source"] if matching else None,
    }
