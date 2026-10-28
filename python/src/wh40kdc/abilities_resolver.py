"""Walks the dataset for every ability that could apply to a chosen unit in a
chosen phase.

Resolution order — stable for snapshot tests:

1. **army** — faction-scoped abilities whose ``ability_type`` is ``"faction"``. One with a
   ``detachment_id`` (a Combat Patrol's own army rule) applies only in that detachment, and
   there drops each army rule it ``replaces`` (``interactions``). In a Combat Patrol
   detachment only the army rules its ``detachment_rule_ids`` list apply.
2. **detachment** — abilities authored against the detachment.
3. **detachment-stratagem** — stratagems on the detachment, each yielding the
   ability referenced by ``stratagem.ability_id`` (if any), when the combined
   unit can be the stratagem's friendly target (its keywords).
4. **unit** — abilities listed in ``unit.ability_ids``.
5. **attached** — abilities of each attached member (pulled in full).
6. **support** — abilities on supporting units that can reach another unit (an aura scope, or
   an effect naming an aura, a unit selection or a friendly/enemy unit filter).

Each step phase-filters via the ``Dataset.phases_for`` index.

Python mirror of ``tools/src/abilities-resolver/resolver.ts``. Entries are
dicts ``{"ability": AbilityView, "source": {...}, "phases": [...]}``; the
corpus compares ability-id sets per source kind.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from wh40kdc.data.dataset import Dataset
from wh40kdc.data.entities import AbilityView, UnitView
from wh40kdc.data.normalize import normalize_name


def resolve_eligible_abilities(
    dataset: Dataset, input: dict[str, Any], phase: str
) -> list[dict[str, Any]]:
    """Compute the eligible-ability list for one (unit, phase)."""

    # Resolve units within the faction when one is known. Unit ids are shared
    # across factions, so a faction-blind `get` can return the wrong faction's
    # copy — and with it the wrong intrinsic abilities/keywords.
    def resolve_unit(id: str, fid: str | None) -> UnitView | None:
        scoped = dataset.units.get_in_faction(id, fid) if fid else None
        return scoped if scoped is not None else dataset.units.get_any(id)

    unit_id = input.get("unitId")
    if not isinstance(unit_id, str):
        return []
    unit = resolve_unit(unit_id, input.get("factionId"))
    if unit is None:
        return []
    faction_id = input.get("factionId") or unit.raw.get("faction_id")
    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    def push_unique(entry: dict[str, Any]) -> None:
        key = f"{entry['source']['kind']}::{entry['ability'].id}"
        if key in seen:
            return
        seen.add(key)
        out.append(entry)

    def phase_matches(ability: AbilityView) -> bool:
        # An ability with no phase-mapping is permissive — surface it
        # everywhere; the translator gates conditional-on-phase internally.
        phases = ability.phases
        return not phases or phase in phases

    def intersect(phases: list[str]) -> list[str]:
        return [phase] if phase in phases else phases

    # 1. Army — faction-scoped abilities (faction rule + any other faction-typed). An army rule
    # with a `detachment_id` is a Combat Patrol box's own army rule: it applies only in that
    # detachment, and there it replaces each army rule it names with `interactions` `replaces`.
    army = [
        ability
        for ability in dataset.abilities.by_faction(faction_id or "")
        if ability.raw.get("ability_type") == "faction"
        and ability.raw.get("detachment_id") in (None, input.get("detachmentId"))
    ]
    replaced = {ref for ability in army for ref in _replaced_ability_ids(ability)}
    # A Combat Patrol detachment's `detachment_rule_ids` are its complete army-rule set.
    patrol = _combat_patrol_detachment(dataset, input.get("detachmentId"), faction_id or "")
    if patrol is not None:
        listed = set(patrol.get("detachment_rule_ids") or [])
        replaced |= {ability.id for ability in army if ability.id not in listed}
    for ability in army:
        if ability.id in replaced:
            continue
        if not phase_matches(ability):
            continue
        push_unique(
            {"ability": ability, "source": {"kind": "army"}, "phases": intersect(ability.phases)}
        )

    detachment_id = input.get("detachmentId")
    if detachment_id:
        # 2. Detachment abilities — abilities whose detachment_id matches.
        for ability in dataset.abilities:
            if ability.raw.get("ability_type") != "detachment":
                continue
            if ability.raw.get("detachment_id") != detachment_id:
                continue
            if not phase_matches(ability):
                continue
            push_unique(
                {
                    "ability": ability,
                    "source": {"kind": "detachment", "detachmentId": detachment_id},
                    "phases": intersect(ability.phases),
                }
            )

        # 3. Detachment stratagems.
        # Shared Codex detachment ids resolve within the requesting faction,
        # falling back first-wins (mirrors the TS resolver).
        detachment = dataset.detachments.get_in_faction(
            detachment_id, faction_id or ""
        ) or dataset.detachments.get_any(detachment_id)
        if detachment is not None:
            # Each member's keywords; a unit target reads them as one combined unit.
            members = [unit] + [
                resolve_unit(member_id, faction_id)
                for member_id in input.get("attachedUnitIds") or []
            ]
            member_keywords = [
                {
                    keyword.lower()
                    for keyword in (member.raw.get("keywords") or [])
                    + (member.raw.get("faction_keywords") or [])
                }
                if member is not None
                else set()
                for member in members
            ]
            printed = _printed_keyword(dataset)
            for strat_id in detachment.get("stratagem_ids") or []:
                stratagem = dataset.stratagems.get(strat_id)
                if stratagem is None:
                    continue
                strat_phases = stratagem.get("phases")
                if not strat_phases or phase not in strat_phases:
                    continue
                ability_id = stratagem.get("ability_id")
                # Ability ids are unique: one record per stratagem, wherever its
                # detachment is replicated.
                strat_ability = (
                    dataset.abilities.get(ability_id) if ability_id is not None else None
                )
                if strat_ability is None:
                    continue
                trigger = strat_ability.raw.get("trigger")
                subject = trigger.get("subject") if isinstance(trigger, dict) else None
                if not stratagem_can_target_unit(stratagem, member_keywords, subject, printed):
                    continue
                push_unique(
                    {
                        "ability": strat_ability,
                        "source": {
                            "kind": "detachment-stratagem",
                            "stratagemId": stratagem["id"],
                            "cpCost": stratagem["cp_cost"],
                            **({"selectsModel": True} if _selects_model(stratagem) else {}),
                        },
                        # The stratagem's printed phase governs eligibility.
                        "phases": [phase],
                    }
                )

    # 4. Unit's own abilities.
    for ability in unit.abilities:
        if not phase_matches(ability):
            continue
        push_unique(
            {
                "ability": ability,
                "source": {"kind": "unit", "unitId": input["unitId"]},
                "phases": intersect(ability.phases),
                **_rated(unit.rating_of(ability.id)),
            }
        )

    # 5. Attached members — the combined unit pools every member's abilities,
    # pulled in full (not aura-filtered like step 6).
    for member_id in input.get("attachedUnitIds") or []:
        member = resolve_unit(member_id, faction_id)
        if member is None:
            continue
        for ability in member.abilities:
            if not phase_matches(ability):
                continue
            push_unique(
                {
                    "ability": ability,
                    "source": {"kind": "attached", "unitId": member_id},
                    "phases": intersect(ability.phases),
                    **_rated(member.rating_of(ability.id)),
                }
            )

    # 6. Supporting units — only abilities that can reach another unit (an aura, a friendly or
    # enemy unit filter, a unit selection); an ability that only names its own unit describes a
    # buff that never reaches the input unit.
    for support_id in input.get("supportingUnitIds") or []:
        supporter = resolve_unit(support_id, faction_id)
        if supporter is None:
            continue
        for ability in supporter.abilities:
            if not phase_matches(ability):
                continue
            if not _is_aura_scope(
                (ability.raw.get("scope") or {}).get("range")
            ) and not reaches_other_units(ability.raw.get("effect")):
                continue
            push_unique(
                {
                    "ability": ability,
                    "source": {"kind": "support", "sourceUnitId": support_id},
                    "phases": intersect(ability.phases),
                    **_rated(supporter.rating_of(ability.id)),
                }
            )

    return out


def _combat_patrol_detachment(
    dataset: Dataset, detachment_id: Any, faction_id: str
) -> dict[str, Any] | None:
    """The detachment ``detachment_id`` names when it is a Combat Patrol box's, else ``None``."""
    if not isinstance(detachment_id, str) or not detachment_id:
        return None
    detachment = dataset.detachments.get_in_faction(
        detachment_id, faction_id
    ) or dataset.detachments.get_any(detachment_id)
    if detachment is None or "combat-patrol" not in (detachment.get("game_modes") or []):
        return None
    return detachment


def _replaced_ability_ids(ability: AbilityView) -> list[str]:
    """The ability ids ``ability`` names with an ``interactions`` entry of type ``replaces``."""
    return [
        entry["ability_ref"]
        for entry in ability.raw.get("interactions") or []
        if entry.get("type") == "replaces"
    ]


def _rated(rating: Any) -> dict[str, Any]:
    """``{"rating": r}`` for a rated rule the owning unit prints, else nothing."""
    return {} if rating is None else {"rating": rating}


def reaches_other_units(effect: Any) -> bool:
    """Whether an effect can reach a unit other than its own: an aura, a unit-filter target
    (friendly or enemy), or a unit selection. The translator decides what of it reaches the
    input unit."""
    if isinstance(effect, list):
        return any(reaches_other_units(child) for child in effect)
    if not isinstance(effect, dict):
        return False
    if effect.get("type") in ("aura", "select-units"):
        return True
    target = effect.get("target")
    if isinstance(target, dict) and target.get("owner") in ("friendly", "enemy"):
        return True
    return any(reaches_other_units(child) for child in effect.values())


def _is_aura_scope(range_: Any) -> bool:
    if isinstance(range_, dict):
        return (
            isinstance(range_.get("aura_of"), str)
            or range_.get("aura") is True
            or range_.get("any_on_battlefield") is True
            or range_.get("any_visible") is True
        )
    return isinstance(range_, str) and (
        range_.startswith("aura-") or range_ in ("any-on-battlefield", "any-visible")
    )


def _selects_model(stratagem: dict[str, Any]) -> bool:
    """Whether a stratagem's friendly target is one model rather than a unit."""
    raw = stratagem.get("target_restrictions")
    targets = raw if isinstance(raw, list) else [raw] if raw else []
    return any(
        target.get("side") != "enemy" and target.get("selects") == "model" for target in targets
    )


def stratagem_can_target(stratagem: dict[str, Any], keywords: set[str]) -> bool:
    """Whether a unit with ``keywords`` (lower-cased) can be a stratagem's friendly target.

    A stratagem with no friendly target (none printed, or only enemy targets) does not
    restrict its user here; with several friendly targets, matching any one is enough.
    The resolver does not know which model is the Warlord, so a Warlord target only needs
    a unit that could contain it: one with CHARACTER, the keyword every Warlord carries.
    Mirrors TS ``stratagemCanTarget``.
    """
    return stratagem_can_target_unit(stratagem, [keywords])


def stratagem_can_target_unit(
    stratagem: dict[str, Any],
    members: list[set[str]],
    trigger_subject: Any = None,
    printed: Callable[[str], bool] = lambda _keyword: True,
) -> bool:
    """Whether a unit of ``members`` (each member's keywords: a unit and the units attached to
    it) can be a stratagem's friendly target, as ``stratagem_can_target``.

    A target that selects a model needs one member that meets it alone; a unit target reads
    every member as one combined unit. A target bound to the triggering unit is also held to
    the keyword lists of the ``trigger_subject`` (its ability's ``trigger.subject``). A keyword
    that subject requires and no datasheet prints (``printed`` says which do) is gained in play,
    so it is not held against a unit. Keywords compare by ``normalize_name``. Mirrors TS
    ``stratagemCanTargetUnit``.
    """
    raw = stratagem.get("target_restrictions")
    if not raw:
        return True
    targets = raw if isinstance(raw, list) else [raw]
    friendly = [target for target in targets if target.get("side") != "enemy"]
    if not friendly:
        return True
    normalized = [{normalize_name(keyword) for keyword in member} for member in members]
    combined: set[str] = set().union(*normalized)
    subject = _friendly_subject(trigger_subject)

    def meets(target: dict[str, Any], keywords: set[str]) -> bool:
        def has(keyword: str) -> bool:
            return normalize_name(keyword) in keywords

        def gained(keyword: str) -> bool:
            return has(keyword) or not printed(keyword)

        return (
            (target.get("warlord") is not True or has("character"))
            and _keyword_lists_hold(target, has, has)
            and (
                target.get("bound_to") != "triggering-unit"
                or subject is None
                or _keyword_lists_hold(subject, gained, has)
            )
        )

    return any(
        meets(target, keywords)
        for target in friendly
        for keywords in (normalized if target.get("selects") == "model" else [combined])
    )


def _friendly_subject(subject: Any) -> dict[str, Any] | None:
    """A trigger subject's keyword lists when it names a friendly unit, else None."""
    if not isinstance(subject, dict):
        return None
    owner = subject.get("owner")
    if owner is not None and owner != "friendly":
        return None
    return {
        "required_keywords": subject.get("all_of") or [],
        "required_keywords_any": subject.get("any_of") or [],
        "excluded_keywords": subject.get("none_of") or [],
    }


def _keyword_lists_hold(
    target: dict[str, Any], required: Callable[[str], bool], excluded: Callable[[str], bool]
) -> bool:
    """Whether the required lists hold by ``required`` and no excluded keyword by ``excluded``."""
    any_of = target.get("required_keywords_any") or []
    return (
        all(required(k) for k in target.get("required_keywords") or [])
        and (not any_of or any(required(k) for k in any_of))
        and not any(excluded(k) for k in target.get("excluded_keywords") or [])
    )


def _printed_keyword(dataset: Dataset) -> Callable[[str], bool]:
    """Whether some datasheet prints a keyword (unit or faction keyword), memoised per lookup."""
    seen: dict[str, bool] = {}

    def printed(keyword: str) -> bool:
        key = normalize_name(keyword)
        if key not in seen:
            seen[key] = any(
                normalize_name(own) == key
                for unit in dataset.units
                for own in (unit.raw.get("keywords") or [])
                + (unit.raw.get("faction_keywords") or [])
            )
        return seen[key]

    return printed
