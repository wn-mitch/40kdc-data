"""Levers that come from outside the crunched unit's own ability list: Enhancements a model in
the unit could take, ability records another ability grants to the unit, and raises to the cap
of a lever pool. :meth:`Dataset.stackable_buffs_for` assembles them with the unit's own levers.

Python mirror of ``tools/src/data/lever-providers.ts``. Levers are plain dicts with the TS
camelCase keys (``id``, ``label``, ``buffs``, ``enabled``, ``source``, ``group``, ``cost``,
``requires``, ``requiresLever``, ``requiresOption``, ``excludesOption``, ``raisesCap``).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from wh40kdc.data.enhancement_eligibility import meets_enhancement_groups

if TYPE_CHECKING:
    from wh40kdc.data.dataset import Dataset
    from wh40kdc.data.entities import AbilityView, UnitView

Lever = dict[str, Any]

#: The stance option a lever applies under (``{"requiresOption": option}``) or does not apply
#: under (``{"excludesOption": option}``), each option ``{"ability_id", "option_id"}``.
OptionGate = dict[str, dict[str, str]]


def option_gate(act: dict[str, Any]) -> OptionGate | None:
    """``act``'s stance option gate, if it has one."""
    if act.get("requiresOption"):
        return {"requiresOption": act["requiresOption"]}
    if act.get("excludesOption"):
        return {"excludesOption": act["excludesOption"]}
    return None


class AbilityLevers:
    """Levers one provider contributes, the pools they belong to, and the cap raises and stance
    option gates to resolve.

    ``cap_raises`` maps ``id(lever)`` to the lever and its canonical capacity-raise
    metadata; ``option_requirements`` maps ``id(lever)`` to the lever and its stance
    :data:`OptionGate`. The TS maps are keyed by the lever
    object, which remains alive in ``buffs`` until the owning stance group is resolved.
    """

    def __init__(self) -> None:
        self.buffs: list[Lever] = []
        self.groups: list[dict[str, Any]] = []
        self.cap_raises: dict[int, tuple[Lever, dict[str, Any]]] = {}
        self.option_requirements: dict[int, tuple[Lever, OptionGate]] = {}
        #: Leaf conditions the context leaves undecided, with the ability that raised each.
        self.needs: list[dict[str, Any]] = []

    def raise_cap(self, lever: Lever, raise_: dict[str, Any]) -> None:
        self.cap_raises[id(lever)] = (lever, raise_)

    def require_option(self, lever: Lever, gate: OptionGate) -> None:
        self.option_requirements[id(lever)] = (lever, gate)


def ability_needs(
    unsupported: list[dict[str, Any]], ability_id: str, label: str
) -> list[dict[str, Any]]:
    """Each need an ability's translation reports (``{key, condition, perspective}``), tagged
    with that ability's ``abilityId`` and ``label``."""
    return [
        {**need, "abilityId": ability_id, "label": label}
        for item in unsupported
        for need in item.get("needs") or []
    ]


def combined_unit(
    ds: Dataset, input: dict[str, Any]
) -> tuple[UnitView | None, str, list[UnitView]]:
    """The crunched unit, the faction it is resolved in, and the combined unit (the unit followed
    by its attached members). An explicit ``factionId`` wins over the unit's own faction."""
    unit_id = input.get("unitId") or ""
    input_faction = input.get("factionId")
    unit = (
        ds.units.get_in_faction(unit_id, input_faction) if input_faction else None
    ) or ds.units.get_any(unit_id)
    unit_faction = unit.raw.get("faction_id") if unit is not None else None
    if input_faction is not None:
        faction_id = input_faction
    else:
        faction_id = unit_faction if unit_faction is not None else ""
    members = [
        view
        for view in (
            ds.units.get_in_faction(member_id, faction_id) or ds.units.get_any(member_id)
            for member_id in input.get("attachedUnitIds") or []
        )
        if view is not None
    ]
    return unit, faction_id, [unit, *members] if unit is not None else members


def combined_keywords_lower(units: list[UnitView]) -> list[str]:
    """Lower-cased union of the units' keywords and faction keywords."""
    out: dict[str, None] = {}
    for unit in units:
        for keyword in [*unit.keywords, *unit.faction_keywords]:
            out[keyword.lower()] = None
    return list(out)


def combined_toughness(units: list[UnitView], roles: dict[str, Any] | None = None) -> Any:
    """The Toughness of a (combined) unit: its Bodyguard's when Leaders or Support units are
    attached, as for an attack against it, taking the highest model's. ``roles`` (unit id → role)
    wins over the datasheet's own ``attachment_role``. None when no unit prints a Toughness."""

    def role(unit: UnitView) -> Any:
        given = roles.get(unit.id) if isinstance(roles, dict) else None
        return given if given is not None else unit.raw.get("attachment_role")

    bodyguard = [unit for unit in units if role(unit) not in ("leader", "support")]
    toughness = [
        profile.get("T")
        for unit in (bodyguard or units)
        for profile in unit.raw.get("profiles") or []
    ]
    numbers = [t for t in toughness if isinstance(t, (int, float)) and not isinstance(t, bool)]
    return max(numbers) if numbers else None


def shared_keywords_lower(units: list[UnitView]) -> list[str]:
    """Lower-cased keywords and faction keywords every one of the units carries.

    The data lists keywords per datasheet, so these are the keywords every model of the combined
    unit carries.
    """
    if not units:
        return []
    first, *rest = (combined_keywords_lower([unit]) for unit in units)
    others = [set(keywords) for keywords in rest]
    return [keyword for keyword in first if all(keyword in other for other in others)]


def can_take_enhancement(ds: Dataset, enhancement: dict[str, Any], bearer: UnitView) -> bool:
    """Whether ``bearer`` can take ``enhancement`` under the Select Enhancements rules the roster
    validator enforces: a CHARACTER (or an Upgrade), not an EPIC HERO, with a model that may take
    Enhancements, carrying every keyword of one restriction group and none of the exclusions."""
    keywords = set(combined_keywords_lower([bearer]))

    def has(keyword: str) -> bool:
        return keyword.lower() in keywords

    if not has("character") and enhancement.get("upgrade_tag") is not True:
        return False
    if bearer.raw.get("role") == "epic-hero" or has("epic hero"):
        return False
    composition = ds.unit_composition_of(bearer.raw)
    rows = (composition or {}).get("models") or []
    if rows and all(model.get("excluded_from_enhancements") is True for model in rows):
        return False
    eligible = meets_enhancement_groups(enhancement, bearer.id, has)
    return eligible and not any(has(k) for k in enhancement.get("exclusion_keywords") or [])


def ability_levers(
    ds: Dataset,
    *,
    ability: AbilityView,
    source: dict[str, Any],
    rating: Any = None,
    ctx: dict[str, Any],
    faction_id: str,
    id_base: str,
    label: str,
    enabled: bool,
    gate: dict[str, Any] | None = None,
    held: set[str],
) -> AbilityLevers:
    """The levers one eligible ability gives the crunched unit.

    - Buffs it applies outright form one lever ``id_base``, on by default when ``enabled``.
    - A cost-bearing provider (``gate``: a Stratagem, an Enhancement) is one opt-in lever
      ``id_base`` carrying the cost, even when it applies no buff itself; its choices and the
      records it grants name it in ``requiresLever``, so the cost is paid once.
    - Its choices are opt-in levers in their own pools; a lever raising another pool's cap is
      recorded for :func:`resolve_cap_raises`.
    - Each ability record it grants to the unit (not already among ``held``) is translated as the
      unit's own ability, with the provider's default state. ``held`` is extended with each grant.
    """
    out = AbilityLevers()
    translation = ability.describe_buffs(source, ctx, "attacker", rating)
    out.needs.extend(ability_needs(translation["unsupported"], ability.id, label))
    grants = [g for g in granted_record_ids(translation) if g["abilityId"] not in held]
    levers: list[Lever] = []
    requires_lever = id_base if gate else None

    for act in translation["activatable"]:
        lever = lever_from_activatable(act, f"{ability.name} — {act['label']}", source)
        if requires_lever:
            lever["requiresLever"] = requires_lever
        for group in [*([act["group"]] if act.get("group") else []), *(act.get("groups") or [])]:
            if not any(g["id"] == group["id"] for g in out.groups):
                out.groups.append(
                    {
                        **group,
                        "label": ability.name,
                        "abilityId": ability.id,
                    }
                )
        if act.get("capRaise"):
            out.raise_cap(lever, act["capRaise"])
        gated = option_gate(act)
        if gated is not None:
            out.require_option(lever, gated)
        levers.append(lever)
    for grant in grants:
        held.add(grant["abilityId"])
        granted = granted_record_levers(
            ds,
            grant["abilityId"],
            faction_id,
            {
                "abilityId": ability.id,
                "source": source,
                "enabled": False if gate else enabled,
                "requiresLever": requires_lever,
            },
            ctx,
        )
        if granted is None:
            continue
        levers.extend(granted["buffs"])
        out.groups.extend(granted["groups"])
        out.cap_raises.update(granted["capRaises"])
        out.option_requirements.update(granted["optionRequirements"])
        out.needs.extend(granted["needs"])

    if gate:
        if translation["applied"] or levers:
            gate_lever: Lever = {
                "id": id_base,
                "label": label,
                "buffs": translation["applied"],
                "enabled": False,
                "source": source,
                "cost": gate["cost"],
            }
            if gate.get("group"):
                gate_lever["group"] = gate["group"]
            out.buffs.append(gate_lever)
    elif translation["applied"]:
        out.buffs.append(
            {
                "id": id_base,
                "label": label,
                "buffs": translation["applied"],
                "enabled": enabled,
                "source": source,
            }
        )
    out.buffs.extend(levers)
    return out


def enhancement_levers(
    ds: Dataset,
    *,
    detachment_id: str | None,
    crunched_unit_id: str,
    bearers: list[UnitView],
    ctx: dict[str, Any],
    faction_id: str,
    held: set[str],
) -> AbilityLevers:
    """One lever per (Enhancement, bearer) pair a detachment offers the combined unit, costing
    the Enhancement's points, in a pool of one per bearer (a model takes at most one
    Enhancement). The bearer's model-scoped effects stay on that model when it is not the
    crunched unit (core rule 19.04), as for any attached member's ability."""
    out = AbilityLevers()
    if not detachment_id:
        return out
    seen: set[str] = set()
    offered: list[dict[str, Any]] = []
    # The detachment id is a reference: its Enhancements resolve whatever mode they
    # list in, so a combat-patrol detachment still offers its own.
    for enhancement in ds.for_game_mode("all").enhancements:
        if enhancement.get("detachment_id") != detachment_id or enhancement["id"] in seen:
            continue
        seen.add(enhancement["id"])
        offered.append(enhancement)
    for bearer in bearers:
        group = f"enhancement@{bearer.id}"
        before = len(out.buffs)
        for enhancement in offered:
            ability_id = enhancement.get("ability_id")
            if not ability_id or not can_take_enhancement(ds, enhancement, bearer):
                continue
            ability = ds.abilities.get_in_faction(
                ability_id, bearer.faction_id
            ) or ds.abilities.get_any(ability_id)
            if ability is None:
                continue
            if bearer.id == crunched_unit_id:
                source = {"kind": "ability", "abilityId": ability.id, "abilityKind": "unit"}
            else:
                source = {
                    "kind": "ability",
                    "abilityId": ability.id,
                    "abilityKind": "attached",
                    "sourceUnitId": bearer.id,
                }
            levers = ability_levers(
                ds,
                ability=ability,
                source=source,
                ctx=ctx,
                faction_id=faction_id,
                id_base=f"enhancement:{enhancement['id']}@{bearer.id}",
                label=f"{enhancement['name']} ({bearer.name})",
                enabled=False,
                gate={"cost": {"points": enhancement.get("cost")}, "group": group},
                held=set(held),
            )
            out.buffs.extend(levers.buffs)
            out.groups.extend(levers.groups)
            out.cap_raises.update(levers.cap_raises)
            out.option_requirements.update(levers.option_requirements)
            out.needs.extend(levers.needs)
        if len(out.buffs) > before:
            out.groups.append(
                {"id": group, "label": f"Enhancement on {bearer.name}", "maxActivations": 1}
            )
    return out


def lever_from_activatable(act: dict[str, Any], label: str, source: dict[str, Any]) -> Lever:
    """A lever from a translator activatable, keeping its primary pool and every intersecting
    parent activation pool."""
    lever: Lever = {
        "id": act["id"],
        "label": label,
        "buffs": act["buffs"],
        "enabled": False,
        "source": source,
    }
    if act.get("group"):
        lever["group"] = act["group"]["id"]
    if act.get("groups"):
        lever["groups"] = [group["id"] for group in act["groups"]]
    if act.get("requires") is not None:
        lever["requires"] = act["requires"]
    return lever


#: Grant targets that name the crunched unit (or the aura recipient it is) once the translator
#: let the grant through.
_GRANT_RECIPIENTS = frozenset(["this-unit", "ability-unit", "recipient", "selected-unit"])


def granted_record_ids(translation: dict[str, Any]) -> list[dict[str, Any]]:
    """The ability records a translation grants to the crunched unit: each unsupported
    ``ability-grant`` naming a record that reaches the unit. The translator has already dropped
    grants whose filter excludes the unit or that name the providing unit itself, so a grant that
    reached ``unsupported`` with a self or friendly-filter target reaches the crunched unit."""
    out: list[dict[str, Any]] = []
    for item in translation["unsupported"]:
        node = item.get("effectFragment")
        if not isinstance(node, dict) or node.get("type") != "ability-grant":
            continue
        modifier = node.get("modifier")
        if (
            not isinstance(modifier, dict)
            or not isinstance(modifier.get("ability"), str)
            or modifier.get("definition") is not None
        ):
            continue
        target = node.get("target")
        if isinstance(target, str):
            reaches = target in _GRANT_RECIPIENTS
        else:
            reaches = isinstance(target, dict) and target.get("owner") == "friendly"
        if reaches and not any(g["abilityId"] == modifier["ability"] for g in out):
            out.append({"abilityId": modifier["ability"], "fragment": item})
    return out


def granted_record_levers(
    ds: Dataset,
    granted_id: str,
    faction_id: str,
    provider: dict[str, Any],
    ctx: dict[str, Any],
) -> dict[str, Any] | None:
    """Translate a granted record as the crunched unit's own ability and return its buffs as
    levers the grant provides. Ids are prefixed with the granting ability so two grants of the
    same record stay distinct. None when the record does not resolve."""
    record = ds.abilities.get_in_faction(granted_id, faction_id) or ds.abilities.get_any(granted_id)
    if record is None:
        return None
    # The granted ability is held by the crunched unit: its "this unit" is the crunched unit.
    held = {"kind": "ability", "abilityId": record.id, "abilityKind": "unit"}
    translation = record.describe_buffs(held, ctx, "attacker")
    buffs: list[Lever] = []
    groups: dict[str, dict[str, Any]] = {}
    cap_raises: dict[int, tuple[Lever, dict[str, Any]]] = {}
    option_requirements: dict[int, tuple[Lever, OptionGate]] = {}
    prefix = f"{provider['abilityId']}>"
    requires_lever = provider.get("requiresLever")
    dependency = {"requiresLever": requires_lever} if requires_lever else {}
    if translation["applied"]:
        buffs.append(
            {
                "id": f"{prefix}{record.id}",
                "label": record.name,
                "buffs": translation["applied"],
                "enabled": provider["enabled"],
                "source": provider["source"],
                **dependency,
            }
        )
    for act in translation["activatable"]:
        lever = lever_from_activatable(act, f"{record.name} — {act['label']}", provider["source"])
        lever["id"] = f"{prefix}{act['id']}"
        for parent in [*([act["group"]] if act.get("group") else []), *(act.get("groups") or [])]:
            group = f"{prefix}{parent['id']}"
            groups.setdefault(
                group,
                {
                    **parent,
                    "id": group,
                    "label": record.name,
                    "abilityId": record.id,
                },
            )
        if act.get("group"):
            lever["group"] = f"{prefix}{act['group']['id']}"
        if act.get("groups"):
            lever["groups"] = [f"{prefix}{parent['id']}" for parent in act["groups"]]
        lever.update(dependency)
        buffs.append(lever)
        if act.get("capRaise"):
            cap_raises[id(lever)] = (lever, act["capRaise"])
        gated = option_gate(act)
        if gated is not None:
            option_requirements[id(lever)] = (lever, gated)
    return {
        "buffs": buffs,
        "groups": list(groups.values()),
        "capRaises": cap_raises,
        "optionRequirements": option_requirements,
        "needs": ability_needs(translation["unsupported"], record.id, record.name),
    }


def resolve_cap_raises(
    levers: list[Lever],
    pending: dict[int, tuple[Lever, dict[str, Any]]],
    groups: list[dict[str, Any]],
) -> list[Lever]:
    """Resolve each cap-raising lever to the stance pool owned by the named ability."""
    out: list[Lever] = []
    for lever in levers:
        entry = pending.get(id(lever))
        if entry is None or entry[0] is not lever:
            out.append(lever)
            continue
        raise_ = entry[1]
        group = next(
            (
                candidate
                for candidate in groups
                if candidate.get("abilityId") == raise_["ability"]
                and candidate["id"].endswith("?stance")
            ),
            None,
        )
        if group is not None:
            allocation = {key: value for key, value in raise_.items() if key != "ability"}
            out.append({**lever, "raisesCap": {**allocation, "group": group["id"]}})
    return out


def resolve_option_requirements(
    levers: list[Lever],
    pending: dict[int, tuple[Lever, OptionGate]],
    groups: list[dict[str, Any]],
    option_label: Callable[[dict[str, str]], str],
) -> list[Lever]:
    """Bind each lever gated on a stance option to that option's lever, found by the owning
    ability's immutable id and the option id. An option that gives no buff of its own has no
    lever; it gets a buffless one in the stance's pool, so picking it still excludes the other
    options. Where the stance pool is not available the unit cannot pick the option: a lever
    requiring it is dropped, and a lever excluding it always applies."""
    added: list[Lever] = []

    def option_lever(option: dict[str, str]) -> str | None:
        group = next(
            (
                candidate
                for candidate in groups
                if candidate.get("abilityId") == option["ability_id"]
                and candidate["id"].endswith("?stance")
            ),
            None,
        )
        if group is None:
            return None
        suffix = f"#{option['option_id']}"
        found = next(
            (
                lever
                for lever in [*levers, *added]
                if lever.get("group") == group["id"] and lever["id"].endswith(suffix)
            ),
            None,
        )
        if found is not None:
            return found["id"]
        sibling = next(lever for lever in levers if lever.get("group") == group["id"])
        sibling_id = sibling["id"]
        lever_id = f"{sibling_id[: sibling_id.rfind('#')]}{suffix}"
        synthesized: Lever = {
            "id": lever_id,
            "label": f"{group['label']} — {option_label(option)}",
            "buffs": [],
            "enabled": False,
            "source": sibling["source"],
            "group": group["id"],
        }
        if sibling.get("requiresLever"):
            synthesized["requiresLever"] = sibling["requiresLever"]
        added.append(synthesized)
        return lever_id

    resolved: list[Lever] = []
    for lever in levers:
        entry = pending.get(id(lever))
        if entry is None or entry[0] is not lever:
            resolved.append(lever)
            continue
        gate = entry[1]
        if gate.get("requiresOption"):
            requires_option = option_lever(gate["requiresOption"])
            if requires_option is not None:
                resolved.append({**lever, "requiresOption": requires_option})
            continue
        if gate.get("excludesOption"):
            excludes_option = option_lever(gate["excludesOption"])
            resolved.append(
                {**lever, "excludesOption": excludes_option} if excludes_option else lever
            )
            continue
        resolved.append(lever)
    return [*resolved, *added]


def stance_option_name(effect: Any, option_id: str) -> str | None:
    """The name of option ``option_id`` of a ``stance-select`` in ``effect``, if it has one."""
    if isinstance(effect, list):
        for item in effect:
            found = stance_option_name(item, option_id)
            if found:
                return found
        return None
    if not isinstance(effect, dict):
        return None
    options = effect.get("options")
    if effect.get("type") == "stance-select" and isinstance(options, list):
        option = next(
            (
                candidate
                for candidate in options
                if isinstance(candidate, dict) and candidate.get("id") == option_id
            ),
            None,
        )
        name = option.get("name") if option is not None else None
        if isinstance(name, str) and name:
            return name
    for value in effect.values():
        found = stance_option_name(value, option_id)
        if found:
            return found
    return None
