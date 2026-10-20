"""Translate an Ability DSL ``effect`` tree into the Buff stack it contributes
(for an attacker-perspective crunch) along with a list of effect fragments the
translator could not auto-apply.

The buff layer is intentionally a subset of the DSL: it covers the math the
cruncher's expected-value engine reads and reports everything else — choice
nodes (player decisions), dice-gated effects (stochastic), defender-side
Ballistic Skill modifiers, attack-restrictions, unsupported ability grants, mortal wound
triggers — as ``unsupported`` so a UI can surface "this ability has effects
we can't auto-apply" rather than silently dropping them.

Python mirror of ``tools/src/cruncher/from-dsl.ts``. Applied-buff list order
and unsupported-reason strings are pinned by
``conformance/abilities-resolver/from-dsl.json`` /
``defensive-from-dsl.json``.
"""

from __future__ import annotations

import math
from typing import Any, TypeGuard

from wh40kdc.cruncher import from_dsl_levers as _levers
from wh40kdc.cruncher import from_dsl_selection as _selection
from wh40kdc.cruncher.buffs import Buff, BuffSource, EngineContext
from wh40kdc.cruncher.from_dsl_shapes import (
    UNSUPPORTED_SHAPE_REASONS,
    enumerate_roll_allocation,
    roll_label,
    scaled_to_cap,
    unsized_value_reason,
)
from wh40kdc.scope import unit_matches_applies_to

EffectTranslation = dict[str, Any]

#: Targets that resolve to the buffed unit itself.
_SELF_TARGETS = frozenset(["this-unit", "ability-unit", "this-model", "selected-unit", "recipient"])
#: The subset of :data:`_SELF_TARGETS` naming a single *model* (the bearer) rather
#: than its unit. Core rule 19.04: a rule affecting one specified model applies
#: only to that model, even while it is part of an attached unit.
_MODEL_TARGETS = frozenset(["this-model"])
#: Unit-refs that name a unit the buff layer cannot identify with the buffed unit.
_UNRESOLVED_TARGETS = frozenset(
    ["event-subject", "event-object", "stratagem-target", "bearer-transport"]
)
#: Diagnostic emitted for a model-scoped effect pooled in from an attached member.
_MODEL_SCOPED_REASON = (
    "model-scoped effect from an attached model: applies to that model only (core rule 19.04)"
)
_ATTACKER_TARGET = "attacker"
#: The unit-ref that names the other side of an attack from the attacker's view.
_DEFENDER_TARGETS = frozenset(["defender"])


RECIPIENT_SNAPSHOT_UNAVAILABLE = (
    "trigger-time recipient snapshot is unavailable; current membership cannot "
    "establish historical recipients"
)
_STOCHASTIC_DICE_GATED_REASON = "dice-gated effect: stochastic; not expressible as a buff"


def effect_to_buffs(
    effect: Any,
    source: BuffSource,
    context: EngineContext,
    perspective: str = "attacker",
    activation: dict[str, Any] | None = None,
) -> EffectTranslation:
    """Translate an effect tree and preserve player-controlled activation metadata."""
    out: EffectTranslation = {"applied": [], "unsupported": [], "activatable": []}
    if recipient_snapshot_reason(None, effect) is not None:
        snapshot = resolve_recipient_snapshots(None, effect, source, context, perspective)
        if snapshot.get("reason"):
            out["unsupported"].append(
                {
                    "reason": snapshot["reason"],
                    "effectFragment": effect,
                }
            )
            return out
        effect = snapshot["effect"]
    ability_id = source.get("abilityId", "effect") if source.get("kind") == "ability" else "effect"
    opts = {
        "context": context,
        "perspective": perspective,
        "abilityId": ability_id,
        "duration": activation.get("duration") if activation else None,
    }
    _walk(effect, source, opts, out)
    if activation and (
        activation.get("usage") is not None
        or activation.get("cost") is not None
        or activation.get("optional") is True
    ):
        limits_value = activation.get("usage")
        limits = limits_value if isinstance(limits_value, list) else [limits_value]
        counts: list[float] = []
        for limit in limits:
            if not _is_object(limit) or limit.get("per") == "model":
                continue
            count = limit.get("count")
            if isinstance(count, (int, float)) and not isinstance(count, bool):
                counts.append(float(count))
            elif limit.get("frequency") != "n-per-battle":
                counts.append(1)
        group = {"id": f"{ability_id}?usage", "maxActivations": min(counts)} if counts else None
        if out["applied"]:
            lever: dict[str, Any] = {
                "id": f"{ability_id}#activate",
                "label": _label_for_buffs(out["applied"]),
                "buffs": out["applied"],
            }
            if group:
                lever["group"] = group
            out["activatable"].append(lever)
            out["applied"] = []
        for lever in out["activatable"]:
            if group and lever.get("group", {}).get("id") != group["id"]:
                if lever.get("group"):
                    lever["groups"] = [*(lever.get("groups") or []), group]
                else:
                    lever["group"] = group
            requirement = {key: value for key, value in activation.items() if key != "duration"}
            lever["requires"] = [requirement, *(lever.get("requires") or [])]
    return out


def _is_object(value: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(value, dict)


def _is_model_scoped_from_attached_member(node: dict[str, Any], source: BuffSource) -> bool:
    """Is this node a model-scoped effect reaching the buffed unit from *another*
    member of the combined unit? Core rule 19.04 keeps those on their own model:
    an attached Librarian's personal 4+ invulnerable save is not a 4+ invulnerable
    save for the ten Intercessors it joined.

    Keyed on the buff *source*, not on the DSL condition — the leak is not limited
    to abilities gated on an attachment-role condition (an Archon's Shadowfield
    says only "the bearer"), and the resolver already tags pooled member abilities
    as ``abilityKind: "attached"``. An ability read as the chosen unit's own
    (``abilityKind: "unit"``) is unaffected."""
    if source.get("kind") != "ability" or source.get("abilityKind") != "attached":
        return False
    target = node.get("target")
    return isinstance(target, str) and target in _MODEL_TARGETS


def _aura_filter_keywords(
    node: dict[str, Any],
    modifier: dict[str, Any],
    opts: dict[str, Any],
    out: EffectTranslation,
) -> bool:
    """Apply an aura's recipient gate, rejecting filters the buff context cannot resolve."""
    if "recipient_filter" in modifier:
        recipient = modifier.get("recipient_filter")
        if not _is_object(recipient):
            out["unsupported"].append(
                {
                    "reason": "aura recipient keywords are unavailable or its filter is malformed",
                    "effectFragment": node,
                }
            )
            return False
        all_of = recipient.get("all_of", [])
        any_of = recipient.get("any_of", [])
        none_of = recipient.get("none_of", [])
        not_all_of = recipient.get("not_all_of", [])
        if set(recipient) - {"all_of", "any_of", "none_of", "not_all_of"} or any(
            not isinstance(keywords, list)
            or any(not isinstance(keyword, str) or not keyword for keyword in keywords)
            for keywords in (all_of, any_of, none_of, not_all_of)
        ):
            out["unsupported"].append(
                {
                    "reason": "aura recipient keywords are unavailable or its filter is malformed",
                    "effectFragment": node,
                }
            )
            return False
        context_key = "attackerKeywords" if opts["perspective"] == "attacker" else "targetKeywords"
        context_keywords = opts["context"].get(context_key)
        if not isinstance(context_keywords, list) or any(
            not isinstance(keyword, str) or not keyword for keyword in context_keywords
        ):
            out["unsupported"].append(
                {
                    "reason": "aura recipient keywords are unavailable or its filter is malformed",
                    "effectFragment": node,
                }
            )
            return False
        available = {keyword.lower() for keyword in context_keywords}
        if any(keyword.lower() not in available for keyword in all_of):
            return False
        if any_of and not any(keyword.lower() in available for keyword in any_of):
            return False
        if any(keyword.lower() in available for keyword in none_of):
            return False
        if not_all_of and all(keyword.lower() in available for keyword in not_all_of):
            return False
    if "emitter_filter" in modifier:
        out["unsupported"].append(
            {
                "reason": "aura emitter filter requires the source unit's keywords",
                "effectFragment": node,
            }
        )
        return False
    return True


def _walk(node: Any, source: BuffSource, opts: dict[str, Any], out: EffectTranslation) -> None:
    if not _is_object(node):
        return
    # Core rule 19.04 gate, applied before any leaf translation and under both
    # perspectives. Safe at this level because no container node (`sequence`,
    # `conditional`, `choice`, …) carries a `this-model` target — only leaves
    # do — so this can never swallow a subtree holding unit-scoped effects too.
    if _is_model_scoped_from_attached_member(node, source):
        out["unsupported"].append({"reason": _MODEL_SCOPED_REASON, "effectFragment": node})
        return
    # An ability grant reports its own unresolved holders.
    if (
        isinstance(node.get("target"), str)
        and node["target"] in _UNRESOLVED_TARGETS
        and node.get("type") != "ability-grant"
    ):
        out["unsupported"].append(
            {
                "reason": f'target "{node["target"]}" is not resolved by the buff engine',
                "effectFragment": node,
            }
        )
        return
    if opts.get("defaultTarget") is not None and "target" not in node:
        node = {**node, "target": opts["defaultTarget"]}
    # A unit selection reaching the selected unit is a player lever; its eligibility is what the
    # player vouches for, so it is planned before the fidelity check below.
    if node.get("type") == "select-units":
        plan = _selection.plan_selection(node, source, opts["perspective"], opts["context"])
        if plan["kind"] != "none":
            _selection.translate_selection(plan, node, source, opts, out)
            return
    if node.get("type") == "for-each-unit":
        bound = _selection.bind_each_recipient(node)
        if bound is not None:
            _walk(bound, source, opts, out)
            return
    if _has_unresolved_fidelity_binding(node):
        out["unsupported"].append({"reason": _FIDELITY_BINDING_REASON, "effectFragment": node})
        return
    # A scaled or bound value (a count on the board, the battle size, a bound roll) has no fixed
    # size here: applying the printed value would over- or under-state it.
    unsized = unsized_value_reason(node)
    if unsized is not None:
        # A capped scaling ("+2 A per embarked model, to a maximum of +22") is a lever at its cap;
        # the player vouches for the count that reaches it.
        at_cap = scaled_to_cap(node)
        if at_cap is not None:
            _selection.offer_lever(
                at_cap,
                source,
                opts,
                out,
                {
                    "id": f"{opts['abilityId']}#at-cap",
                    "label": "At its maximum",
                    "requires": [node.get("scaling")],
                },
            )
            return
        out["unsupported"].append({"reason": unsized, "effectFragment": node})
        return
    # An ability another unit provides reaches the crunched unit only through a friendly filter,
    # an aura's recipient or a selection; its own unit and model are the provider, not the
    # crunched unit.
    if (
        _selection.is_provided_by_another_unit(source)
        and isinstance(node.get("target"), str)
        and node["target"] in _selection.PROVIDER_TARGETS
    ):
        return
    target = node.get("target")
    if _is_object(target):
        if target.get("member_of") == "attacker":
            side = "attacker"
        elif target.get("member_of") == "defender" or target.get("owner") == "enemy":
            side = "target"
        else:
            side = "attacker" if opts["perspective"] == "attacker" else "target"
        verdict = _matches_unit_filter(
            target,
            opts["context"],
            side,
            "enemy" if target.get("owner") == "enemy" else "friendly",
        )
        if verdict is False:
            return
        if verdict == "unknown":
            out["unsupported"].append(
                {
                    "reason": (
                        "unit-filter target: identity, state or model membership is unresolved"
                    ),
                    "effectFragment": node,
                }
            )
            return
    # An `incoming` change modifies attacks made against its target. On the buffed unit it is the
    # attacker's side of those attacks, which the `target: "attacker"` form already models; it never
    # modifies the buffed unit's own attacks.
    # On the defender it changes every friendly attack against that unit, the buffed unit's among
    # them, so the attacker perspective reads it as a change for friendly units; the target
    # perspective has no such attack.
    node_modifier = node.get("modifier")
    if (
        _is_object(node_modifier)
        and node_modifier.get("incoming") is True
        and _classify_target(node) == "defender"
    ):
        if opts["perspective"] != "attacker":
            return
        stripped = {k: v for k, v in node_modifier.items() if k != "incoming"}
        _walk({**node, "target": {"owner": "friendly"}, "modifier": stripped}, source, opts, out)
        return
    if (
        _is_object(node_modifier)
        and node_modifier.get("incoming") is True
        and _classify_target(node) == "self"
    ):
        if opts["perspective"] == "attacker":
            return
        if node.get("type") in ("roll-modifier", "stat-modifier"):
            stripped = {k: v for k, v in node_modifier.items() if k != "incoming"}
            _walk({**node, "target": _ATTACKER_TARGET, "modifier": stripped}, source, opts, out)
        else:
            out["unsupported"].append(
                {
                    "reason": (
                        f"{_js_str(node.get('type'))}: an incoming change to attacks "
                        "against the unit is not modelled"
                    ),
                    "effectFragment": node,
                }
            )
        return
    node_type = node.get("type")
    if node_type == "re-roll":
        _translate_reroll(node, source, opts, out)
    elif node_type == "roll-modifier":
        _translate_roll_modifier(node, source, opts, out)
    elif node_type == "stat-modifier":
        _translate_stat_modifier(node, source, opts, out)
    elif node_type == "feel-no-pain":
        _translate_feel_no_pain(node, source, opts, out)
    elif node_type == "weapon-ability-grant":
        _translate_keyword_grant(node, source, opts, out)
    elif node_type == "damage-reduction":
        _translate_damage_reduction(node, source, opts, out)
    elif node_type == "invulnerable-save":
        _translate_invulnerable_save(node, source, opts, out)
    elif node_type == "named-region-state":
        _translate_named_region_state(node, source, opts, out)
    elif node_type == "conditional":
        _translate_conditional(node, source, opts, out)
    elif node_type in ("rules-bundle", "sequence"):
        for step in node.get("steps") or []:
            _walk(step, source, opts, out)
    elif node_type == "ability-part":
        if node.get("trigger") is not None:
            effect = node.get("effect")
            bound = _selection.bind_event_subject(
                node["trigger"], effect, opts["context"], opts["perspective"]
            )
            if bound is not effect:
                _walk({**node, "effect": bound}, source, opts, out)
                return
        part_opts = {**opts, "duration": node.get("duration", opts.get("duration"))}
        if (
            node.get("optional") is True
            or node.get("cost") is not None
            or node.get("usage") is not None
        ):
            _translate_named_effect(node, source, part_opts, out)
        else:
            gated = moment_gate(node.get("trigger"), node.get("effect"), node)
            _walk(gated, source, part_opts, out)
    elif node_type == "choice":
        # Player decision — each branch becomes an opt-in lever (pick one).
        _enumerate_choice(node, source, opts, out)
    elif node_type == "dice-gated":
        # Probabilistic; the buff layer is deterministic.
        out["unsupported"].append(
            {
                "reason": _STOCHASTIC_DICE_GATED_REASON,
                "effectFragment": node,
            }
        )
    elif node_type == "dice-pool-allocation":
        # Player spends dice on options at runtime — each buff-bearing option
        # becomes an opt-in lever, grouped under the pool's activation cap.
        _enumerate_dice_pool(node, source, opts, out)
    elif node_type == "roll":
        # A pool roll whose dice are allocated to named options (Blessings of Khorne) is the
        # same lever set dice-pool-allocation produced; any other bound roll only scopes its
        # nested effect.
        if not enumerate_roll_allocation(
            node, source, opts, out, _collect_gated_buffs, _label_for_buffs
        ):
            _walk(node.get("effect"), source, opts, out)
    elif node_type in UNSUPPORTED_SHAPE_REASONS:
        out["unsupported"].append(
            {"reason": UNSUPPORTED_SHAPE_REASONS[node_type], "effectFragment": node}
        )
    elif node_type == "select-units":
        # Targeting wrapper — the selected units receive the nested effect.
        _walk(node.get("effect"), source, opts, out)
    elif node_type == "aura":
        # An aura's own target names the side it reaches, not a unit-ref: friendly
        # recipients are the buffed side, enemy ones the other.
        aura_target = node.get("target")
        side = (
            "self"
            if aura_target == "friendly-within-aura"
            else "defender"
            if aura_target == "enemy-within-aura"
            else "unknown"
        )
        if side == "unknown" or (side == "defender" and opts["perspective"] != "target"):
            return
        modifier = node.get("modifier")
        if not _is_object(modifier):
            out["unsupported"].append(
                {
                    "reason": "aura without nested effect: not a combat buff",
                    "effectFragment": node,
                }
            )
            return
        if not _aura_filter_keywords(node, modifier, opts, out):
            return
        effect = modifier.get("effect")
        if isinstance(effect, dict):
            _walk(effect, source, opts, out)
        else:
            out["unsupported"].append(
                {
                    "reason": "aura without nested effect: not a combat buff",
                    "effectFragment": node,
                }
            )
    elif node_type == "designate-target":
        # Mark an enemy unit; when `to: attackers-of-target` or
        # `to: bearer-attacks-target` the nested effect is a buff the attacks
        # against that unit receive (Oath of Moment). Which enemy unit is
        # designated is the player's pick, so its buffs are one opt-in lever
        # ("this defender is the designated unit"); the player vouches for the
        # selection's eligibility (range, visibility, "hit by those attacks").
        # A `to: target` debuff lands on the enemy, not the bearer, so it is not
        # a buff in this perspective.
        applies_raw = node.get("applies")
        applies = applies_raw if isinstance(applies_raw, dict) else {}
        if applies.get("to") in ("attackers-of-target", "bearer-attacks-target"):
            for filt in (
                applies.get("attacker_filter"),
                applies.get("attacker_unit_filter"),
            ):
                if filt is None:
                    continue
                verdict = _matches_unit_filter(filt, opts["context"], "attacker", "friendly")
                if verdict is False:
                    return
                if verdict == "unknown":
                    out["unsupported"].append(
                        {
                            "reason": "designate-target attacker filter is unresolved",
                            "effectFragment": node,
                        }
                    )
                    return
            sub: EffectTranslation = {"applied": [], "unsupported": [], "activatable": []}
            _walk(applies.get("effect"), source, opts, sub)
            out["unsupported"].extend(sub["unsupported"])
            requirement = {
                "select": node.get("select"),
                "duration": node.get("duration"),
            }
            for lever in sub["activatable"]:
                lever["requires"] = [requirement, *(lever.get("requires") or [])]
            out["activatable"].extend(sub["activatable"])
            if sub["applied"]:
                designation_value = node.get("designation")
                designation = (
                    designation_value if isinstance(designation_value, str) else "designated"
                )
                out["activatable"].append(
                    {
                        "id": f"{opts['abilityId']}#{designation}",
                        "label": f"Designated target: {_label_for_buffs(sub['applied'])}",
                        "buffs": sub["applied"],
                        "requires": [requirement],
                    }
                )
        else:
            out["unsupported"].append(
                {
                    "reason": (
                        "designate-target debuff on the marked unit: not a buff on the bearer"
                    ),
                    "effectFragment": node,
                }
            )
    elif node_type == "risk-reward":
        # The reward is the buff; the risk (self-damage on a failed test) is not.
        _walk(node.get("reward"), source, opts, out)
    elif node_type == "stance-selection-capacity":
        _translate_stance_capacity(node, source, opts, out)
    elif node_type == "stance-select":
        # Pick-one modal buff — each option is an opt-in lever (pick one).
        _enumerate_named_options(node, source, opts, out, f"{opts['abilityId']}?stance", 1)
    elif node_type == "issue-orders":
        # Officer issues one Order from the menu — each is an opt-in lever.
        _enumerate_named_options(node, source, opts, out, f"{opts['abilityId']}?order", 1)
    elif node_type == "resource-action-menu":
        # Each action is an INDEPENDENT reactive lever, not a pick-one group:
        # unlike stance-select/issue-orders, multiple actions (and repeats of
        # the same action by different units — see
        # `usage.repeatable_if_different_unit`) can fire in the same phase,
        # so no shared `group`/`maxActivations` cap is attached here.
        _enumerate_menu_actions(node, source, opts, out)
    elif node_type == "roll-result":
        _levers.translate_roll_result(node, source, opts, out)
    elif node_type == "ignore-modifiers":
        _levers.translate_ignore_modifiers(node, source, opts, out)
    elif node_type == "ability-grant":
        _levers.translate_ability_grant(node, source, opts, out)
    elif node_type == "ability-modifier":
        _levers.translate_ability_modifier(node, source, opts, out)
    else:
        # Unknown effect — record it. Covers ability-grant, deep-strike,
        # mortal-wounds, cp-gain, movement-modifier, etc.
        out["unsupported"].append(
            {
                "reason": f'effect type "{_js_str(node_type)}" is not modelled by the buff layer',
                "effectFragment": node,
            }
        )


# ---------------------------------------------------------------------------
# Leaf translators
# ---------------------------------------------------------------------------


def _classify_target(node: dict[str, Any]) -> str:
    """Classify a node's ``target`` field: ``"self"`` / ``"attacker"`` /
    ``"defender"`` / ``"unknown"``."""
    target = node.get("target")
    # A unit filter reaches every unit it matches: friendly ones are the buffed side,
    # enemy ones the other.
    if _is_object(target) and "event_var" not in target and "selection_var" not in target:
        if target.get("owner") == "friendly":
            return "self"
        if target.get("owner") == "enemy":
            return "defender"
        return "unknown"
    if not isinstance(target, str):
        return "unknown"
    if target == _ATTACKER_TARGET:
        return "attacker"
    if target in _DEFENDER_TARGETS:
        return "defender"
    if target in _SELF_TARGETS:
        return "self"
    return "unknown"


def _applies_to_buffed_unit(node: dict[str, Any], perspective: str) -> bool:
    """Does this node's target match the buffed unit under the perspective?"""
    cls = _classify_target(node)
    if cls == "self":
        return True
    if cls == "attacker":
        return perspective == "attacker"
    if cls == "defender":
        return perspective == "target"
    return False


def _translate_reroll(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    # Rerolls are inherently attacker-side. Apply only under the matching
    # perspective so a target-perspective walk doesn't grab the attacker's
    # reroll-failed-hits buff.
    if opts["perspective"] == "attacker" and not _applies_to_buffed_unit(node, "attacker"):
        return
    modifier = node.get("modifier")
    if not _is_object(modifier):
        out["unsupported"].append(
            {"reason": "re-roll: missing modifier object", "effectFragment": node}
        )
        return
    narrowed = _unhonorable_narrowing(modifier)
    if narrowed:
        out["unsupported"].append(
            {
                "reason": (
                    f're-roll: narrows by "{narrowed}" which the cruncher can\'t resolve here'
                ),
                "effectFragment": node,
            }
        )
        return
    roll = modifier.get("roll")
    # A `value: 1` on a re-roll modifier unambiguously means "re-roll rolls of
    # 1". A historical migration mis-defaulted such nodes to `subset:
    # "all-failures"`; honor the value as the source of truth.
    subset = "ones" if modifier.get("value") == 1 else modifier.get("subset")
    # Under target perspective, only "save" rerolls fire on the buffed unit.
    if opts["perspective"] == "target" and roll != "save":
        return
    # Finite permissions are non-linear over a roll pool. Until the cruncher
    # carries the exact pool distribution, applying this as an uncapped reroll
    # would silently overstate the effect.
    if modifier.get("count") is not None:
        out["unsupported"].append(
            {
                "reason": (
                    "re-roll: count-capped permissions are not modelled "
                    "by the expected-value engine"
                ),
                "effectFragment": node,
            }
        )
        return
    if roll in ("hit", "wound", "save", "damage") and subset in ("ones", "all-failures"):
        out["applied"].append(
            with_applicability(
                {
                    "source": source,
                    "contribution": {"type": "reroll", "roll": roll, "subset": subset},
                },
                weapon_applicability(modifier),
            )
        )
        return
    out["unsupported"].append(
        {
            "reason": (
                f're-roll on "{roll_label(roll)}" (subset "{_js_str(subset)}") '
                "is outside the damage path"
            ),
            "effectFragment": node,
        }
    )


def _translate_roll_modifier(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    modifier = node.get("modifier")
    if not _is_object(modifier):
        out["unsupported"].append(
            {"reason": "roll-modifier: missing modifier object", "effectFragment": node}
        )
        return
    narrowed = _unhonorable_narrowing(modifier)
    if narrowed:
        out["unsupported"].append(
            {
                "reason": (
                    f'roll-modifier: narrows by "{narrowed}" which the cruncher can\'t resolve here'
                ),
                "effectFragment": node,
            }
        )
        return
    value = _signed_value(modifier)
    if value is None:
        out["unsupported"].append(
            {
                "reason": (
                    f'roll-modifier: operation "{_js_str(modifier.get("operation"))}" not supported'
                ),
                "effectFragment": node,
            }
        )
        return
    roll = modifier.get("roll")
    # A change to the attacker's roll belongs to the side it favours: one that helps the attacker
    # is the attacking side's own rule, one that hinders it defends the unit being attacked.
    attacker_change = _classify_target(node) == "attacker"
    # Each roll type is intrinsically on one side. Hit / wound / damage are
    # attacker-side; save is defender-side.
    if opts["perspective"] == "attacker":
        if attacker_change and value < 0:
            return
        if not _applies_to_buffed_unit(node, "attacker"):
            return
        if roll == "save":
            return  # saves apply to the defender, not the attacker.
    else:
        # Target perspective accepts: self+save (own save rolls), or
        # attacker+hit/wound (penalty to incoming attacker rolls).
        cls = _classify_target(node)
        if cls == "attacker":
            if roll not in ("hit", "wound"):
                return
            if attacker_change and value > 0:
                return
        elif cls == "self":
            if roll != "save":
                return
        else:
            return
    contribution_type = (
        {
            "hit": "hit-mod",
            "wound": "wound-mod",
            "save": "save-mod",
            "damage": "damage-mod",
        }.get(roll)
        if isinstance(roll, str)
        else None
    )
    if contribution_type is None:
        out["unsupported"].append(
            {
                "reason": f'roll-modifier on "{roll_label(roll)}" is outside the damage path',
                "effectFragment": node,
            }
        )
        return
    out["applied"].append(
        with_applicability(
            {"source": source, "contribution": {"type": contribution_type, "value": value}},
            weapon_applicability(modifier),
        )
    )


def _translate_stat_modifier(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    modifier = node.get("modifier")
    if not _is_object(modifier):
        out["unsupported"].append(
            {"reason": "stat-modifier: missing modifier object", "effectFragment": node}
        )
        return
    narrowed = _unhonorable_narrowing(modifier)
    if narrowed:
        out["unsupported"].append(
            {
                "reason": (
                    f'stat-modifier: narrows by "{narrowed}" which the cruncher can\'t resolve here'
                ),
                "effectFragment": node,
            }
        )
        return
    stat = modifier.get("stat")
    is_on_buffed_unit = _applies_to_buffed_unit(node, opts["perspective"])
    # Attack classification and structured weapon scopes both become phase/name/keyword gates.
    applicability = combine_optional(
        combine_optional(
            _attack_type_applicability(modifier),
            _weapon_type_applicability(modifier),
        ),
        weapon_applicability(modifier),
    )

    def emit(contribution: dict[str, Any]) -> None:
        out["applied"].append(
            with_applicability({"source": source, "contribution": contribution}, applicability)
        )

    # AP has an inverted sign convention and offensive/defensive variants.
    if stat == "AP":
        _translate_ap_modifier(node, modifier, opts, out, emit)
        return

    # WS/BS on the attacker is a defender-side rule: it penalises incoming hit rolls of that
    # attack type (e.g. Benefit of Cover), so it is a `hit-mod` under target perspective. On the
    # buffed unit it changes the characteristic its own attacks hit on.
    if stat in ("BS", "WS"):
        phases = ["shooting" if stat == "BS" else "fight"]
        if _classify_target(node) == "attacker":
            if opts["perspective"] != "target":
                return
            skill = _signed_value(modifier)
            if skill is not None:
                out["applied"].append(
                    {
                        "source": source,
                        "applicableWhen": {"phases": phases},
                        "contribution": {"type": "hit-mod", "value": skill},
                    }
                )
            return
        if opts["perspective"] != "attacker" or not is_on_buffed_unit:
            return
        operation = modifier.get("operation")
        # Only a numeric value sizes the change; a missing or null one is not read as 0.
        raw = _numeric_value(modifier)
        improvement = raw if operation == "improve" else -raw if operation == "worsen" else math.nan
        if not math.isfinite(improvement):
            out["unsupported"].append(
                {
                    "reason": (
                        f'stat-modifier {stat}: operation "{_js_str(operation)}" not supported'
                    ),
                    "effectFragment": node,
                }
            )
            return
        emit({"type": "skill-mod", "stat": stat, "value": _intify(improvement + 0.0)})
        return

    # Setting the Save characteristic is defender-side; any other set stat outside A/S/T is off
    # the damage path, and a set A/S/T has no single delta.
    if modifier.get("operation") == "set":
        if stat == "Sv":
            if opts["perspective"] != "target":
                out["unsupported"].append(
                    {
                        "reason": (
                            "stat-modifier Sv: defender-side stat; applies when the "
                            "buffed unit is the target"
                        ),
                        "effectFragment": node,
                    }
                )
                return
            save_value = _numeric_value(modifier)
            if not is_on_buffed_unit:
                return
            if math.isfinite(save_value) and save_value.is_integer() and 2 <= save_value <= 6:
                emit({"type": "save-characteristic", "value": int(save_value)})
            elif math.isnan(save_value):
                out["unsupported"].append(
                    {"reason": "stat-modifier Sv: set has no numeric value", "effectFragment": node}
                )
            else:
                out["unsupported"].append(
                    {
                        "reason": (
                            f'stat-modifier Sv: set value "{_num_str(save_value)}" '
                            "is not a save characteristic"
                        ),
                        "effectFragment": node,
                    }
                )
            return
        if stat not in ("A", "S", "T", "D"):
            out["unsupported"].append(
                {
                    "reason": f'stat-modifier on "{_js_str(stat)}" is outside the damage path',
                    "effectFragment": node,
                }
            )
            return

    value = _signed_value(modifier)
    if value is None:
        out["unsupported"].append(
            {
                "reason": (
                    f'stat-modifier: operation "{_js_str(modifier.get("operation"))}" not supported'
                ),
                "effectFragment": node,
            }
        )
        return
    if stat == "A":
        if opts["perspective"] != "attacker" or not is_on_buffed_unit:
            return
        emit({"type": "attacks-mod", "value": value})
    elif stat == "S":
        if opts["perspective"] != "attacker" or not is_on_buffed_unit:
            return
        emit({"type": "strength-mod", "value": value})
    elif stat == "T":
        # Defender stat. Only relevant under target perspective.
        if opts["perspective"] != "target":
            out["unsupported"].append(
                {
                    "reason": (
                        "stat-modifier T: defender-side stat; applies when the "
                        "buffed unit is the target"
                    ),
                    "effectFragment": node,
                }
            )
            return
        if not is_on_buffed_unit:
            return
        emit({"type": "toughness-mod", "value": value})
    elif stat == "Sv":
        # Improvement is a save-roll bonus; literal characteristic addition worsens the Save.
        if opts["perspective"] != "target":
            out["unsupported"].append(
                {
                    "reason": (
                        "stat-modifier Sv: defender-side stat; applies when the "
                        "buffed unit is the target"
                    ),
                    "effectFragment": node,
                }
            )
            return
        if not is_on_buffed_unit:
            return
        save_mod = value if modifier.get("operation") in ("improve", "worsen") else -value
        emit({"type": "save-mod", "value": save_mod})
    else:
        out["unsupported"].append(
            {
                "reason": f'stat-modifier on "{_js_str(stat)}" is outside the damage path',
                "effectFragment": node,
            }
        )


def _translate_ap_modifier(
    node: dict[str, Any],
    modifier: dict[str, Any],
    opts: dict[str, Any],
    out: EffectTranslation,
    emit: Any,
) -> None:
    """AP stat-modifier: offensive (self/unit target) → attacker-side
    ``ap-mod``; defensive (``target: "attacker"``) → an ``ap-mod`` on incoming
    attacks under the target perspective (the engine floors AP at 0)."""
    if _classify_target(node) == "attacker":
        if opts["perspective"] != "target":
            out["unsupported"].append(
                {
                    "reason": (
                        "stat-modifier AP on the attacker: defender-side stat; applies when "
                        "the buffed unit is the target"
                    ),
                    "effectFragment": node,
                }
            )
            return
        incoming_delta = _ap_delta(modifier)
        if incoming_delta is None:
            out["unsupported"].append(
                {
                    "reason": (
                        f'stat-modifier AP: operation "{_js_str(modifier.get("operation"))}" '
                        "not supported"
                    ),
                    "effectFragment": node,
                }
            )
            return
        emit({"type": "ap-mod", "value": incoming_delta})
        return
    if opts["perspective"] != "attacker" or not _applies_to_buffed_unit(node, "attacker"):
        return
    delta = _ap_delta(modifier)
    if delta is None:
        out["unsupported"].append(
            {
                "reason": (
                    f'stat-modifier AP: operation "{_js_str(modifier.get("operation"))}" '
                    "not supported"
                ),
                "effectFragment": node,
            }
        )
        return
    emit({"type": "ap-mod", "value": delta})


def _translate_feel_no_pain(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    # FNP applies when the buffed unit is the *target*. Under attacker
    # perspective drop silently rather than as `unsupported`.
    if opts["perspective"] != "target":
        return
    modifier = node.get("modifier")
    if not _is_object(modifier):
        out["unsupported"].append(
            {"reason": "feel-no-pain: missing modifier object", "effectFragment": node}
        )
        return
    threshold = _js_number(modifier.get("threshold"))
    if not math.isfinite(threshold):
        out["unsupported"].append(
            {"reason": "feel-no-pain: threshold not numeric", "effectFragment": node}
        )
        return
    threshold = _intify(threshold)
    # `modifier.against` ∈ {"all", "mortal", "psychic", "psychic-and-mortal"}
    # (default "all"); anything else is routed to unsupported so a malformed value can't
    # masquerade as an all-FNP. `psychic-and-mortal` folds into the mortal
    # stream (its mortal-wound coverage is exact; the psychic-attack half is
    # invisible to the buff layer); bare `psychic` has no stream to attach to,
    # so it stays unsupported rather than overstating defence.
    raw_scope = modifier.get("against")
    scope = "all"
    if raw_scope is not None:
        if raw_scope in ("all", "mortal"):
            scope = raw_scope
        elif raw_scope == "psychic-and-mortal":
            scope = "mortal"
        elif raw_scope == "psychic":
            out["unsupported"].append(
                {
                    "reason": (
                        'feel-no-pain: against "psychic" '
                        "(psychic attacks are not tracked by the buff layer)"
                    ),
                    "effectFragment": node,
                }
            )
            return
        else:
            out["unsupported"].append(
                {
                    "reason": (
                        f'feel-no-pain: unrecognised against "{_js_str(raw_scope)}" '
                        '(expected "all" or "mortal")'
                    ),
                    "effectFragment": node,
                }
            )
            return
    contribution = (
        {"type": "feel-no-pain", "threshold": threshold, "scope": "mortal"}
        if scope == "mortal"
        else {"type": "feel-no-pain", "threshold": threshold}
    )
    out["applied"].append({"source": source, "contribution": contribution})


def _translate_keyword_grant(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    """Translate catalog-backed weapon keyword grants without parsing display text."""
    if opts["perspective"] != "attacker" or not _applies_to_buffed_unit(node, "attacker"):
        return
    modifier = node.get("modifier")
    if not _is_object(modifier):
        return
    removes = modifier.get("removes")
    if isinstance(removes, list):
        for keyword in removes:
            label = (
                _keyword_label(keyword)
                if _is_object(keyword) and isinstance(keyword.get("keyword_id"), str)
                else "unresolved keyword"
            )
            out["unsupported"].append(
                {
                    "reason": (
                        "weapon-ability-removal: the cruncher does not model removing "
                        f'a weapon ability ("{label}")'
                    ),
                    "effectFragment": {"removes": [keyword]},
                }
            )
    keywords = modifier.get("keywords")
    if not isinstance(keywords, list):
        return
    applicability = combine_optional(
        _weapon_type_applicability(modifier), weapon_applicability(modifier)
    )
    for ref in keywords:
        if not _is_weapon_keyword_ref(ref):
            out["unsupported"].append(
                {
                    "reason": "keyword-grant: malformed catalog keyword reference",
                    "effectFragment": {"keyword": ref},
                }
            )
            continue
        parameters = ref.get("parameters")
        if (
            isinstance(parameters, dict)
            and "value" in parameters
            and (
                not isinstance(parameters["value"], (int, float, str))
                or isinstance(parameters["value"], bool)
            )
        ):
            out["unsupported"].append(
                {
                    "reason": "weapon-ability-grant: keyword rating quantity is unresolved",
                    "effectFragment": {"keyword": ref},
                }
            )
            continue
        buff: Buff = {
            "source": source,
            "contribution": {"type": "extra-keyword", "keywordRef": ref},
        }
        out["applied"].append({**buff, "applicableWhen": applicability} if applicability else buff)


def _is_weapon_keyword_ref(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("keyword_id"), str)
        and bool(value["keyword_id"])
    )


def _weapon_scope(modifier: dict[str, Any]) -> dict[str, Any]:
    scope = modifier.get("weapons")
    return scope if isinstance(scope, dict) else {}


def _weapon_type_applicability(modifier: dict[str, Any]) -> dict[str, Any] | None:
    scope = _weapon_scope(modifier)
    if scope.get("type") == "melee":
        return {"phases": ["fight"]}
    if scope.get("type") == "ranged":
        return {"phases": ["shooting"]}
    return None


def _attack_type_applicability(modifier: dict[str, Any]) -> dict[str, Any] | None:
    """Map an attack classification to the phase in which it occurs."""
    kind = modifier.get("attack_type")
    if kind == "melee":
        return {"phases": ["fight"]}
    if kind == "ranged":
        return {"phases": ["shooting"]}
    return None


_UNHONORABLE_NARROWING = (
    "weapon_profile",
    "weapon_filter",
    "model_filter",
    "model_scope",
)


def _unhonorable_narrowing(modifier: dict[str, Any]) -> str | None:
    for key in _UNHONORABLE_NARROWING:
        if modifier.get(key) is not None:
            return key
    scope = _weapon_scope(modifier)
    if scope.get("ref") is not None:
        return "weapons.ref"
    return None


def _numeric_value(modifier: dict[str, Any]) -> float:
    """``modifier.value`` when it is a number (JS ``typeof value === "number"``), else NaN."""
    value = modifier.get("value")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return math.nan


def weapon_applicability(modifier: dict[str, Any]) -> dict[str, Any] | None:
    """Translate the canonical structured weapon scope into buff gates."""
    scope = _weapon_scope(modifier)
    out: dict[str, Any] = {}
    name = scope.get("name")
    if isinstance(name, str):
        out["weaponName"] = name.lower()
    excluded_name = scope.get("exclude_name")
    if isinstance(excluded_name, str):
        out["excludedWeaponNames"] = [excluded_name.lower()]
    elif isinstance(excluded_name, list):
        out["excludedWeaponNames"] = [x.lower() for x in excluded_name if isinstance(x, str)]
    keyword = scope.get("keyword")
    if _is_weapon_keyword_ref(keyword):
        out["weaponKeywords"] = [keyword]
    elif isinstance(keyword, list) and keyword and all(_is_weapon_keyword_ref(x) for x in keyword):
        out["weaponKeywords"] = keyword
    excluded_keyword = scope.get("exclude_keyword")
    if _is_weapon_keyword_ref(excluded_keyword):
        out["excludedWeaponKeywords"] = [excluded_keyword]
    elif isinstance(excluded_keyword, list) and all(
        _is_weapon_keyword_ref(x) for x in excluded_keyword
    ):
        out["excludedWeaponKeywords"] = excluded_keyword
    return out or None


def combine_optional(a: dict[str, Any] | None, b: dict[str, Any] | None) -> dict[str, Any] | None:
    """Combine two optional applicabilities (TS ``combineOptional``)."""
    if a and b:
        return _combine_applicability(a, b)
    return a if a is not None else b


def _weapon_gate_part(applicability: dict[str, Any]) -> dict[str, Any]:
    fields = {
        "weaponName",
        "excludedWeaponNames",
        "weaponKeywords",
        "excludedWeaponKeywords",
        "weaponRequirements",
    }
    return {key: value for key, value in applicability.items() if key in fields}


def with_applicability(buff: Buff, applicability: dict[str, Any] | None) -> Buff:
    """Attach ``applicability`` to ``buff`` when present."""
    return {**buff, "applicableWhen": applicability} if applicability else buff


def _translate_damage_reduction(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    """Defender-side damage-reduction. Only the additive numeric form is
    modelled — ``"half"`` / ``"to-zero"`` are one-use ablation effects."""
    if opts["perspective"] != "target":
        return
    if not _applies_to_buffed_unit(node, "target"):
        return
    modifier = node.get("modifier")
    if not _is_object(modifier):
        out["unsupported"].append(
            {"reason": "damage-reduction: missing modifier object", "effectFragment": node}
        )
        return
    reduction = modifier.get("reduction")
    if (
        isinstance(reduction, (int, float))
        and not isinstance(reduction, bool)
        and math.isfinite(reduction)
        and reduction > 0
    ):
        out["applied"].append(
            {"source": source, "contribution": {"type": "damage-reduction", "value": reduction}}
        )
        return
    if reduction in ("half", "to-zero"):
        out["unsupported"].append(
            {
                "reason": (
                    f'damage-reduction: "{reduction}" is a one-use ablation effect, '
                    "not modelled by the expected-value engine"
                ),
                "effectFragment": node,
            }
        )
        return
    out["unsupported"].append(
        {
            "reason": f'damage-reduction: unrecognised reduction "{_js_str(reduction)}"',
            "effectFragment": node,
        }
    )


def _translate_invulnerable_save(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    """Defender-side ability-granted invulnerable save."""
    if opts["perspective"] != "target":
        return
    if not _applies_to_buffed_unit(node, "target"):
        return
    modifier = node.get("modifier")
    if not _is_object(modifier):
        out["unsupported"].append(
            {"reason": "invulnerable-save: missing modifier object", "effectFragment": node}
        )
        return
    threshold = _js_number(modifier.get("invuln_sv"))
    if not math.isfinite(threshold) or threshold < 2 or threshold > 7:
        out["unsupported"].append(
            {
                "reason": (
                    f'invulnerable-save: invuln_sv "{_js_str(modifier.get("invuln_sv"))}" '
                    "is not a valid save threshold (2–7)"
                ),
                "effectFragment": node,
            }
        )
        return
    out["applied"].append(
        {
            "source": source,
            "contribution": {"type": "invulnerable-save", "threshold": _intify(threshold)},
        }
    )


def _translate_named_region_state(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    """Recover a named region's default attacker branch when its gate matches."""
    if opts["perspective"] != "attacker":
        return
    modifier_raw = node.get("modifier")
    modifier: dict[str, Any] = {}
    if _is_object(modifier_raw):
        modifier = modifier_raw
    consumer_raw = modifier.get("consumer")
    consumer: dict[str, Any] = {}
    if _is_object(consumer_raw):
        consumer = consumer_raw
    gate_raw = consumer.get("beneficiary_filter")
    gate = gate_raw if _is_object(gate_raw) else {}
    allowed = {"owner", "level", "all_of", "any_of", "none_of", "not_all_of"}
    all_of = gate.get("all_of", [])
    any_of = gate.get("any_of", [])
    none_of = gate.get("none_of", [])
    not_all_of = gate.get("not_all_of", [])
    if (
        not gate
        or set(gate) - allowed
        or any(
            not isinstance(keywords, list)
            or any(not isinstance(keyword, str) or not keyword for keyword in keywords)
            for keywords in (all_of, any_of, none_of, not_all_of)
        )
    ):
        out["unsupported"].append(
            {
                "reason": (
                    "named-region-state beneficiary filter cannot be evaluated "
                    "against current attacker keywords"
                ),
                "effectFragment": node,
            }
        )
        return
    attacker_keywords = opts["context"].get("attackerKeywords")
    if not isinstance(attacker_keywords, list):
        out["unsupported"].append(
            {
                "reason": (
                    "named-region-state beneficiary filter cannot be evaluated "
                    "against current attacker keywords"
                ),
                "effectFragment": node,
            }
        )
        return
    current = {keyword.lower() for keyword in attacker_keywords if isinstance(keyword, str)}
    eligible = (
        all(keyword.lower() in current for keyword in all_of)
        and (not any_of or any(keyword.lower() in current for keyword in any_of))
        and not any(keyword.lower() in current for keyword in none_of)
        and not (not_all_of and all(keyword.lower() in current for keyword in not_all_of))
    )
    if not eligible:
        return
    default_branch_raw = consumer.get("default_branch")
    default_branch: dict[str, Any] | None = (
        default_branch_raw if _is_object(default_branch_raw) else None
    )
    if default_branch is None:
        out["unsupported"].append(
            {
                "reason": "named-region-state default branch is missing",
                "effectFragment": node,
            }
        )
        return
    _walk(default_branch.get("effect"), source, opts, out)
    qualified_branch_raw = consumer.get("qualified_branch")
    qualified_branch = qualified_branch_raw if _is_object(qualified_branch_raw) else None
    if qualified_branch is not None:
        out["unsupported"].append(
            {
                "reason": (
                    "named-region-state qualified branch: region membership is unavailable "
                    "in EngineContext; qualified replacement is unsupported"
                ),
                "effectFragment": qualified_branch,
            }
        )


def _translate_conditional(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    condition = node.get("condition")
    effect = node.get("effect")
    if not _is_object(condition):
        return
    if node.get("_activation_source") is not None and is_post_own_attack_moment(
        node.get("_activation_trigger")
    ):
        out["unsupported"].append(
            {"reason": POST_ATTACK_MOMENT, "effectFragment": node["_activation_source"]}
        )
        return
    evaluated = condition
    if node.get("_activation_source") is not None:
        evaluated = _elide_historical_clocks(condition, opts.get("duration"))
    verdict = _evaluate_condition(
        evaluated,
        opts["context"],
        opts["perspective"],
        None if opts.get("grantedHolder") else source,
    )
    if verdict == "unknown":
        # An operator condition (`not`, `and`, `or`) is named by its operator.
        condition_name = condition.get("type")
        if condition_name is None:
            condition_name = condition.get("operator")
        if _condition_mentions_timing(evaluated):
            _enumerate_timing_gate({**node, "condition": evaluated}, source, opts, out)
        else:
            out["unsupported"].append(
                {
                    "reason": (
                        "conditional: cannot evaluate condition "
                        f'"{_js_str(condition_name)}" against current context'
                    ),
                    "effectFragment": node.get("_activation_source", node),
                }
            )
        return
    if verdict:
        _walk(effect, source, opts, out)


def _translate_named_effect(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    """Walk a named sub-ability, making activation requirements opt-in."""
    if (
        node.get("optional") is not True
        and node.get("cost") is None
        and node.get("trigger") is None
        and node.get("usage") is None
    ):
        _walk(node.get("effect"), source, opts, out)
        return
    gated = moment_gate(node.get("trigger"), node.get("effect"), node)
    body = gated
    if _is_object(gated) and _is_object(gated.get("condition")):
        condition = _elide_historical_clocks(gated["condition"], opts.get("duration"))
        verdict = _evaluate_condition(
            condition,
            opts["context"],
            opts["perspective"],
            None if opts.get("grantedHolder") else source,
        )
        if _condition_mentions_timing(condition) and verdict is not False:
            body = node.get("effect")
    sub: EffectTranslation = {"applied": [], "unsupported": [], "activatable": []}
    _walk(body, source, opts, sub)
    out["unsupported"].extend(sub["unsupported"])
    requirement = {key: value for key, value in node.items() if key != "effect"}
    for lever in sub["activatable"]:
        lever["requires"] = [requirement, *(lever.get("requires") or [])]
    out["activatable"].extend(sub["activatable"])
    if sub["applied"]:
        name_value = node.get("name")
        name = name_value if isinstance(name_value, str) else _label_for_buffs(sub["applied"])
        out["activatable"].append(
            {
                "id": f"{opts['abilityId']}#{name}",
                "label": name,
                "buffs": sub["applied"],
                "requires": [requirement],
            }
        )


# ---------------------------------------------------------------------------
# Activatable-lever enumeration
# ---------------------------------------------------------------------------


# Rolls inside every attack: a trigger on one applies to each attack it modifies.
_ATTACK_STEP_ROLLS: frozenset[str] = frozenset({"hit", "wound", "save", "damage"})


def is_attack_step(trigger: Any) -> bool:
    """A trigger on a step of every attack (a hit, wound, save or damage roll, or allocating
    damage)."""
    if not _is_object(trigger):
        return False
    if trigger.get("event") == "damage-allocated":
        return True
    filt = trigger.get("filter")
    roll = filt.get("roll") if _is_object(filt) else None
    return (
        trigger.get("event") in ("before-roll", "after-roll")
        and isinstance(roll, str)
        and roll in _ATTACK_STEP_ROLLS
    )


def moment_key(trigger: dict[str, Any]) -> str:
    """The lever key of a trigger: its event family and the filter value that tells moments
    apart (``<event>[:<detail>]``)."""
    filt = trigger.get("filter")
    f = filt if _is_object(filt) else {}
    move_types = f.get("move_types")
    candidates = [
        f.get("to"),
        f.get("kind"),
        f.get("roll"),
        "+".join(_js_str(t) for t in move_types) if isinstance(move_types, list) else None,
        f.get("from"),
    ]
    detail = next((v for v in candidates if isinstance(v, str) and len(v) > 0), None)
    event = _js_str(trigger.get("event"))
    return f"{event}:{detail}" if detail else event


def _own_move_fact(trigger: dict[str, Any]) -> dict[str, Any] | None:
    """The unit's own move the engine context records: a Charge move is "charged this turn"."""
    subject = trigger.get("subject")
    if trigger.get("event") != "move-ended" or (subject is not None and subject != "this-unit"):
        return None
    filt = trigger.get("filter")
    types = filt.get("move_types") if _is_object(filt) else None
    types = types if isinstance(types, list) else []
    if len(types) != 1 or types[0] not in ("charge", "advance"):
        return None
    return {
        "type": "happened",
        "parameters": {"event": "move-ended", "filter": {"move_types": types}, "window": "turn"},
    }


#: Reported for a moment after the triggering unit's own attacks: it acts only on later attacks.
POST_ATTACK_MOMENT = "post-attack moment: applies only to attacks made after the triggering unit's"


def is_post_own_attack_moment(trigger: Any) -> bool:
    """Whether every alternative trigger fires just after the ability's own side resolved its
    attacks (``attacks-resolved`` with no subject, ``this-unit``, ``this-model`` or a friendly
    filter). The attacks that fire it are already resolved, so nothing it grants changes them."""
    values = trigger if isinstance(trigger, list) else [trigger]
    triggers = [value for value in values if _is_object(value)]

    def own(item: dict[str, Any]) -> bool:
        if item.get("event") != "attacks-resolved":
            return False
        subject = item.get("subject")
        return (
            subject is None
            or subject == "this-unit"
            or subject == "this-model"
            or (_is_object(subject) and subject.get("owner") == "friendly")
        )

    return len(triggers) > 0 and all(own(item) for item in triggers)


def moment_gate(trigger: Any, effect: Any, source_fragment: Any = None) -> Any:
    """Wrap non-attack triggers as synthetic activation-time conditions."""
    if effect is None:
        return effect
    values = trigger if isinstance(trigger, list) else [trigger]
    triggers = [
        value for value in values if _is_object(value) and isinstance(value.get("event"), str)
    ]
    if not triggers or any(is_attack_step(item) for item in triggers):
        return effect
    gates: list[dict[str, Any]] = []
    for item in triggers:
        own_move = _own_move_fact(item)
        moment = own_move or {
            "type": "timing-is",
            "parameters": {"timing": moment_key(item)},
        }
        parts: list[dict[str, Any]] = [moment]
        if _is_object(item.get("condition")):
            parts.append(item["condition"])
        gates.append(parts[0] if len(parts) == 1 else {"operator": "and", "operands": parts})
    condition = gates[0] if len(gates) == 1 else {"operator": "or", "operands": gates}
    source_value = source_fragment or {
        "type": "ability-part",
        "trigger": trigger,
        "effect": effect,
    }
    return {
        "type": "conditional",
        "condition": condition,
        "effect": effect,
        "_activation_source": source_value,
        "_activation_trigger": trigger,
    }


def same_snapshot_value(left: Any, right: Any) -> bool:
    """Compare snapshot records with order-insensitive object keys and ordered arrays."""
    if left == right:
        return True
    if isinstance(left, list) or isinstance(right, list):
        return (
            isinstance(left, list)
            and isinstance(right, list)
            and len(left) == len(right)
            and all(same_snapshot_value(a, b) for a, b in zip(left, right, strict=True))
        )
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    left_keys = {key for key, value in left.items() if value is not None}
    right_keys = {key for key, value in right.items() if value is not None}
    return left_keys == right_keys and all(
        same_snapshot_value(left[key], right[key]) for key in left_keys
    )


def recipient_snapshot_reason(trigger: Any, effect: Any) -> str | None:
    """Detect trigger-time recipient sets that require caller-attested history."""

    def check(value: Any, active_trigger: Any) -> bool:
        if isinstance(value, list):
            return any(check(child, active_trigger) for child in value)
        if not _is_object(value):
            return False
        inherited = (
            value.get("trigger")
            if value.get("type") == "ability-part" and "trigger" in value
            else active_trigger
        )
        triggers = inherited if isinstance(inherited, list) else [inherited]
        if value.get("type") == "for-each-unit" and any(
            _is_object(item) and isinstance(item.get("event"), str) and not is_attack_step(item)
            for item in triggers
        ):
            return True
        return any(key != "trigger" and check(child, inherited) for key, child in value.items())

    return RECIPIENT_SNAPSHOT_UNAVAILABLE if check(effect, trigger) else None


def resolve_recipient_snapshots(
    trigger: Any,
    effect: Any,
    source: BuffSource,
    context: EngineContext,
    perspective: str,
    base_path: str = "",
) -> dict[str, Any]:
    """Resolve caller-attested historical for-each recipients before trigger gating."""
    side_id = context.get("attackerUnitId" if perspective == "attacker" else "targetUnitId")
    source_id = source.get("sourceUnitId")
    if source.get("abilityKind") == "unit" and source_id is None:
        source_id = side_id
    snapshots = context.get("recipientSnapshots") or []
    resolved = False
    reason: str | None = None

    def visit(node: Any, path: str, event: Any) -> Any:
        nonlocal resolved, reason
        if not isinstance(node, dict):
            return node
        events = event if isinstance(event, list) else [event]
        historical = [
            item
            for item in events
            if isinstance(item, dict)
            and isinstance(item.get("event"), str)
            and not is_attack_step(item)
        ]
        if node.get("type") == "for-each-unit" and historical:
            matches = [
                snap
                for snap in snapshots
                if isinstance(snap, dict)
                and source.get("kind") == "ability"
                and source_id is not None
                and side_id is not None
                and same_snapshot_value(snap.get("source"), source)
                and snap.get("sourceUnitId") == source_id
                and snap.get("perspective") == perspective
                and snap.get("recipientUnitId") == side_id
                and snap.get("selectionPath") == path
                and same_snapshot_value(snap.get("selector"), node.get("selector"))
                and any(same_snapshot_value(snap.get("trigger"), item) for item in historical)
            ]
            if not matches:
                reason = RECIPIENT_SNAPSHOT_UNAVAILABLE
                return {"type": "sequence", "steps": []}
            if any(snap.get("selected") != matches[0].get("selected") for snap in matches):
                reason = "conflicting trigger-time recipient snapshots"
                return {"type": "sequence", "steps": []}
            resolved = True
            if not matches[0].get("selected"):
                return {"type": "sequence", "steps": []}
            bound = _selection.bind_each_recipient(node, "recipient")
            if bound is None:
                reason = "recipient snapshot cannot bind mixed or unresolved recipient effects"
                return {"type": "sequence", "steps": []}
            return bound
        if node.get("type") == "for-each-unit":
            return node
        node_type = node.get("type")
        if node_type in ("sequence", "rules-bundle"):
            return {
                **node,
                "steps": [
                    visit(step, f"{path}/steps/{index}", event)
                    for index, step in enumerate(node.get("steps") or [])
                ],
            }
        if node_type == "conditional":
            return {**node, "effect": visit(node.get("effect"), f"{path}/effect", event)}
        if node_type == "ability-part":
            local = node.get("trigger", event)
            return {
                **{key: value for key, value in node.items() if key != "trigger"},
                "effect": visit(node.get("effect"), f"{path}/effect", local),
            }
        return node

    transformed = visit(effect, base_path, trigger)
    return {"effect": transformed, "resolved": resolved, **({"reason": reason} if reason else {})}


def _enumerate_choice(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    """Emit one lever per ``choice`` branch that yields a buff (pick one)."""
    options = node.get("options")
    if not isinstance(options, list):
        options = []
    max_choices = node.get("max_choices")
    if not isinstance(max_choices, (int, float)) or isinstance(max_choices, bool):
        max_choices = 1
    for i, opt in enumerate(options):
        buffs: list[Buff] = []
        _collect_gated_buffs(opt, source, opts, {}, buffs, out["unsupported"])
        if not buffs:
            continue
        out["activatable"].append(
            {
                "id": f"{opts['abilityId']}?{i}",
                "label": _label_for_buffs(buffs),
                "buffs": buffs,
                "group": {
                    "id": f"{opts['abilityId']}?choice",
                    "maxActivations": max_choices,
                },
            }
        )


def _enumerate_dice_pool(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    """Emit one lever per buff-bearing dice-pool option, capped by
    ``max_activations``."""
    options = node.get("options")
    if not isinstance(options, list):
        options = []
    max_activations = node.get("max_activations")
    if not isinstance(max_activations, (int, float)) or isinstance(max_activations, bool):
        max_activations = len(options)
    for opt in options:
        if not _is_object(opt):
            continue
        buffs: list[Buff] = []
        _collect_gated_buffs(opt.get("effect"), source, opts, {}, buffs, out["unsupported"])
        if not buffs:
            continue
        opt_name = opt.get("name")
        name = opt_name if isinstance(opt_name, str) and opt_name else _label_for_buffs(buffs)
        out["activatable"].append(
            {
                "id": f"{opts['abilityId']}#{name}",
                "label": name,
                "buffs": buffs,
                "group": {"id": opts["abilityId"], "maxActivations": max_activations},
            }
        )


def _translate_stance_capacity(
    node: dict[str, Any], _source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    modifier = node.get("modifier")
    if not _is_object(modifier):
        modifier = {}
    ability_id = modifier.get("ability_id")
    additional = modifier.get("additional_selections")
    allocation = modifier.get("allocation")

    def is_ref(value: Any) -> bool:
        return (
            _is_object(value)
            and isinstance(value.get("ability_id"), str)
            and isinstance(value.get("option_id"), str)
        )

    option = modifier.get("option")
    options = modifier.get("options")
    valid = (
        isinstance(ability_id, str)
        and isinstance(additional, (int, float))
        and not isinstance(additional, bool)
        and allocation in ("fixed-option", "choose-one-option")
        and (allocation != "fixed-option" or is_ref(option))
        and (options is None or (isinstance(options, list) and all(is_ref(ref) for ref in options)))
    )
    if not valid:
        out["unsupported"].append(
            {
                "reason": "stance-selection-capacity: unresolved option reference",
                "effectFragment": node,
            }
        )
        return
    cap_raise: dict[str, Any] = {
        "ability": ability_id,
        "by": additional,
        "allocation": allocation,
    }
    if is_ref(option):
        cap_raise["option"] = option
    if isinstance(options, list):
        cap_raise["options"] = options
    out["activatable"].append(
        {
            "id": f"{opts['abilityId']}#cap",
            "label": f"{additional} more {ability_id} selections",
            "buffs": [],
            "capRaise": cap_raise,
        }
    )


def _enumerate_named_options(
    node: dict[str, Any],
    source: BuffSource,
    opts: dict[str, Any],
    out: EffectTranslation,
    group_id: str,
    max_activations: int,
) -> None:
    """Emit one opt-in lever per buff-bearing named option (stance-select /
    issue-orders)."""
    options = node.get("options")
    if not isinstance(options, list):
        options = []
    for opt in options:
        if not _is_object(opt):
            continue
        buffs: list[Buff] = []
        _collect_gated_buffs(opt.get("effect"), source, opts, {}, buffs, out["unsupported"])
        if not buffs:
            continue
        if node.get("type") == "stance-select":
            option_id = opt.get("id")
            if not isinstance(option_id, str) or not option_id:
                continue
        else:
            option_id = opt.get("name")
        opt_name = opt.get("name")
        name = opt_name if isinstance(opt_name, str) and opt_name else _label_for_buffs(buffs)
        out["activatable"].append(
            {
                "id": f"{opts['abilityId']}#{option_id}",
                "label": name,
                "buffs": buffs,
                "group": {"id": group_id, "maxActivations": max_activations},
            }
        )


def _enumerate_menu_actions(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    """Emit independent opt-in levers for modelable resource menu actions."""
    actions = node.get("actions")
    if not isinstance(actions, list):
        actions = []
    for action in actions:
        if not _is_object(action):
            continue
        eligibility = action.get("eligibility")
        eligibility = eligibility if _is_object(eligibility) else None
        if eligibility is not None and eligibility.get("filter") is not None:
            side = "attacker" if opts["perspective"] == "attacker" else "target"
            verdict = _matches_unit_filter(eligibility["filter"], opts["context"], side, "friendly")
            if verdict is False:
                continue
            if verdict == "unknown":
                out["unsupported"].append(
                    {
                        "reason": "resource-action-menu eligibility filter is unresolved",
                        "effectFragment": action,
                    }
                )
                continue
        requirements = eligibility.get("requires") if eligibility is not None else None
        if isinstance(requirements, list) and any(
            _is_object(condition)
            and _evaluate_condition(
                condition,
                opts["context"],
                opts["perspective"],
                None if opts.get("grantedHolder") else source,
            )
            is False
            for condition in requirements
        ):
            continue
        action_id = action.get("id")
        if not isinstance(action_id, str) or not action_id:
            out["unsupported"].append(
                {
                    "reason": "resource-action-menu action has no stable id",
                    "effectFragment": action,
                }
            )
            continue
        buffs: list[Buff] = []
        _collect_gated_buffs(action.get("effect"), source, opts, {}, buffs, out["unsupported"])
        if not buffs:
            continue
        label_value = action.get("label")
        label = (
            label_value if isinstance(label_value, str) and label_value else _label_for_buffs(buffs)
        )
        requirement = {key: value for key, value in action.items() if key != "effect"}
        shared_usage = node.get("shared_usage")
        shared_usage = shared_usage if _is_object(shared_usage) else None
        cap = shared_usage.get("unit_max_manoeuvres_per_phase") if shared_usage else None
        lever: dict[str, Any] = {
            "id": f"{opts['abilityId']}#{action_id}",
            "label": label,
            "buffs": buffs,
            "requires": [
                {
                    "menu_id": node.get("menu_id"),
                    "pool_id": node.get("pool_id"),
                    "shared_usage": node.get("shared_usage"),
                    "capacity": node.get("capacity"),
                    "action": requirement,
                }
            ],
        }
        if isinstance(cap, (int, float)) and not isinstance(cap, bool):
            lever["group"] = {
                "id": f"{opts['abilityId']}?menu",
                "maxActivations": cap,
            }
        out["activatable"].append(lever)


def _enumerate_timing_gate(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: EffectTranslation
) -> None:
    """Surface a timing-gated activation: inner decisions surface their own
    levers; inner always-on buffs bundle into a single timing lever."""
    condition = node.get("condition")
    if not _is_object(condition):
        return
    activation = node.get("_activation_source")
    requirement = None
    if _is_object(activation):
        requirement = {key: value for key, value in activation.items() if key != "effect"}
    buffs: list[Buff] = []
    _collect_gated_buffs(node.get("effect"), source, opts, {}, buffs)
    sub: EffectTranslation = {"applied": [], "unsupported": [], "activatable": []}
    _walk(node.get("effect"), source, opts, sub)
    out["unsupported"].extend(
        fragment
        for fragment in sub["unsupported"]
        if not (
            _is_object(fragment)
            and fragment.get("reason") == _STOCHASTIC_DICE_GATED_REASON
            and _is_object(fragment.get("effectFragment"))
            and fragment["effectFragment"].get("type") == "dice-gated"
        )
    )
    if requirement:
        for lever in sub["activatable"]:
            lever["requires"] = [requirement, *(lever.get("requires") or [])]
    out["activatable"].extend(sub["activatable"])
    if buffs:
        timing = _extract_timing(condition) or "timing"
        lever = {
            "id": f"{opts['abilityId']}@{timing}",
            "label": _label_for_buffs(buffs),
            "buffs": buffs,
        }
        if requirement:
            lever["requires"] = [requirement]
        out["activatable"].append(lever)


def _collect_gated_buffs(
    node: Any,
    source: BuffSource,
    opts: dict[str, Any],
    applicability: dict[str, Any],
    out_buffs: list[Buff],
    diagnostics: list[dict[str, Any]] | None = None,
) -> None:
    """Walk the body of a player gate, collecting the buffs it would
    contribute. Conditions are deferred to ``applicableWhen`` where
    expressible; nested decisions and stochastic rolls are not modelled."""
    if not _is_object(node):
        return
    node_type = node.get("type")
    if node_type == "conditional":
        condition = node.get("condition")
        if not _is_object(condition):
            return
        app = _condition_to_applicability(condition, opts["perspective"])
        if app == "gate":
            # A nested timing gate: opting into the activation satisfies it.
            _collect_gated_buffs(
                node.get("effect"), source, opts, applicability, out_buffs, diagnostics
            )
            return
        if app == "context":
            # Can't express as a buff gate — only descend when the condition
            # is definitely active against the current context.
            verdict = _evaluate_condition(
                condition,
                opts["context"],
                opts["perspective"],
                None if opts.get("grantedHolder") else source,
            )
            if verdict is True:
                _collect_gated_buffs(
                    node.get("effect"), source, opts, applicability, out_buffs, diagnostics
                )
            elif verdict == "unknown" and diagnostics is not None:
                diagnostics.append(
                    {
                        "reason": (
                            "activation condition cannot be evaluated against current context"
                        ),
                        "effectFragment": node,
                    }
                )
            return
        _collect_gated_buffs(
            node.get("effect"),
            source,
            opts,
            _combine_applicability(applicability, app),
            out_buffs,
            diagnostics,
        )
        return
    if node_type in ("rules-bundle", "sequence"):
        for step in node.get("steps") or []:
            _collect_gated_buffs(step, source, opts, applicability, out_buffs, diagnostics)
        return
    if node_type == "ability-part":
        part_opts = (
            opts if node.get("duration") is None else {**opts, "duration": node.get("duration")}
        )
        if node.get("trigger") is not None or (
            node.get("optional") is not True
            and node.get("cost") is None
            and node.get("usage") is None
        ):
            _collect_gated_buffs(
                moment_gate(node.get("trigger"), node.get("effect"), node),
                source,
                part_opts,
                applicability,
                out_buffs,
                diagnostics,
            )
        return
    if node_type in ("choice", "dice-pool-allocation", "dice-gated"):
        # A decision (or stochastic roll) nested inside an activation. The
        # outer lever already stands for a player choice.
        return
    # Leaf effect — run the normal leaf translators into a throwaway sink,
    # then attach the accumulated applicability.
    tmp: EffectTranslation = {"applied": [], "unsupported": [], "activatable": []}
    _walk(node, source, opts, tmp)
    if diagnostics is not None:
        diagnostics.extend(tmp["unsupported"])
    for b in tmp["applied"]:
        out_buffs.append(_apply_applicability(b, applicability))


def _duration_spans_clock(duration: Any, clock: str) -> bool:
    if not isinstance(duration, str):
        return False
    spans_phases = duration in {
        "turn",
        "battle-round",
        "battle",
        "permanent",
        "while-leading",
        "one-use",
        "control-lost",
    } or duration.startswith("until-")
    if not spans_phases:
        return False
    if clock == "phase":
        return True
    if clock == "turn":
        return duration != "turn"
    return duration not in ("turn", "battle-round")


def _elide_historical_clocks(condition: dict[str, Any], duration: Any) -> dict[str, Any]:
    """Replace only trigger clocks whose effect lifetime can outlast that clock."""
    operator = condition.get("operator")
    operands = condition.get("operands")
    if isinstance(operator, str) and isinstance(operands, list):
        return {
            **condition,
            "operands": [
                _elide_historical_clocks(item, duration) if _is_object(item) else item
                for item in operands
            ],
        }
    condition_type = condition.get("type")
    clock = (
        {
            "phase-is": "phase",
            "player-turn-is": "turn",
            "battle-round": "battle-round",
        }.get(condition_type)
        if isinstance(condition_type, str)
        else None
    )
    if clock is None or not _duration_spans_clock(duration, clock):
        return condition
    return {"type": "timing-is", "parameters": {"timing": f"historical-{clock}"}}


def _condition_mentions_timing(condition: dict[str, Any]) -> bool:
    """Does this condition (or any operand) gate on a player-controlled timing?"""
    if condition.get("type") == "timing-is":
        return True
    if isinstance(condition.get("operator"), str) and isinstance(condition.get("operands"), list):
        return any(_is_object(o) and _condition_mentions_timing(o) for o in condition["operands"])
    return False


def _extract_timing(condition: dict[str, Any]) -> str | None:
    """Pull the first ``timing-is`` timing value out of a (possibly compound)
    condition."""
    if condition.get("type") == "timing-is":
        t = (condition.get("parameters") or {}).get("timing")
        return t if isinstance(t, str) else None
    if isinstance(condition.get("operands"), list):
        for o in condition["operands"]:
            if _is_object(o):
                t = _extract_timing(o)
                if t:
                    return t
    return None


def _condition_to_applicability(condition: dict[str, Any], perspective: str) -> Any:
    """Translate a condition into a buff applicability the resolver can gate
    on. Returns ``"gate"`` for a player-controlled timing, or ``"context"``
    when the condition has no declarative buff representation."""
    if isinstance(condition.get("operator"), str) and isinstance(condition.get("operands"), list):
        if condition["operator"] != "and":
            return "context"
        merged: dict[str, Any] = {}
        for operand in condition["operands"]:
            if not _is_object(operand):
                return "context"
            a = _condition_to_applicability(operand, perspective)
            if a == "gate":
                continue  # timing operand: satisfied by opting in.
            if a == "context":
                return "context"
            merged = _combine_applicability(merged, a)
        return merged
    params = condition.get("parameters")
    params = params if _is_object(params) else None
    ctype = condition.get("type")
    if ctype == "timing-is":
        return "gate"
    if ctype == "phase-is":
        phase = params.get("phase") if params else None
        return {"phases": [phase]} if isinstance(phase, str) else "context"
    if ctype == "matches":
        filt = params.get("filter") if params else None
        if not _is_object(filt) or any(key != "all_of" for key in filt):
            return "context"
        kw = _single_keyword(filt)
        if kw is None:
            return "context"
        subject = params.get("subject") if params else None
        if subject == "defender":
            return {"requiresTargetKeyword": kw}
        if subject == "attacker":
            return {"requiresAttackerKeyword": kw}
        if not _is_buffed_unit(subject):
            return "context"
        return (
            {"requiresTargetKeyword": kw}
            if perspective == "target"
            else {"requiresAttackerKeyword": kw}
        )
    if ctype == "attack-is":
        if params is None or any(k != "attack_type" for k in params):
            return "context"
        t = params.get("attack_type")
        if t == "melee":
            return {"phases": ["fight"]}
        if t == "ranged":
            return {"phases": ["shooting"]}
        return "context"
    return "context"


def _combine_applicability(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Merge two applicabilities; ``phases`` intersect, the rest narrow."""
    out = dict(a)
    left_weapon = _weapon_gate_part(a)
    right_weapon = _weapon_gate_part(b)
    if left_weapon and right_weapon:
        for field in set(left_weapon) | set(right_weapon):
            out.pop(field, None)
        out["weaponRequirements"] = [
            left_weapon,
            right_weapon,
        ]
    if b.get("phases"):
        out["phases"] = (
            [p for p in a["phases"] if p in b["phases"]] if a.get("phases") else b["phases"]
        )
    if b.get("rollType"):
        out["rollType"] = b["rollType"]
    if b.get("requiresTargetKeyword"):
        out["requiresTargetKeyword"] = b["requiresTargetKeyword"]
    if b.get("requiresAttackerKeyword"):
        out["requiresAttackerKeyword"] = b["requiresAttackerKeyword"]
    if b.get("weaponName"):
        out["weaponName"] = b["weaponName"]
    if b.get("weaponKeyword"):
        out["weaponKeyword"] = b["weaponKeyword"]
    if b.get("excludedTargetKeywords") is not None:
        out["excludedTargetKeywords"] = list(
            dict.fromkeys([*(a.get("excludedTargetKeywords") or []), *b["excludedTargetKeywords"]])
        )
    if not (left_weapon and right_weapon):
        for field in _weapon_gate_part(b):
            out[field] = b[field]
    return out


def _apply_applicability(buff: Buff, applicability: dict[str, Any]) -> Buff:
    """Attach an accumulated applicability to a buff (no-op when empty)."""
    if not applicability:
        return buff
    merged = (
        _combine_applicability(buff["applicableWhen"], applicability)
        if buff.get("applicableWhen")
        else applicability
    )
    return {**buff, "applicableWhen": merged}


def _label_for_buffs(buffs: list[Buff]) -> str:
    """A short, deduped human label summarising a lever's contributions."""
    seen: set[str] = set()
    parts: list[str] = []
    for b in buffs:
        p = _describe_contribution(b["contribution"])
        if p not in seen:
            seen.add(p)
            parts.append(p)
    return ", ".join(parts) or "buff"


def _describe_contribution(c: dict[str, Any]) -> str:
    ctype = c.get("type")
    if ctype == "extra-keyword":
        return _keyword_label(c["keywordRef"])
    if ctype == "hit-mod":
        return f"{_signed(c['value'])} to hit"
    if ctype == "wound-mod":
        return f"{_signed(c['value'])} to wound"
    if ctype == "save-mod":
        return f"{_signed(c['value'])} to save"
    if ctype == "damage-mod":
        return f"{_signed(c['value'])} damage"
    if ctype == "attacks-mod":
        return f"{_signed(c['value'])} attacks"
    if ctype == "strength-mod":
        return f"{_signed(c['value'])} strength"
    if ctype == "toughness-mod":
        return f"{_signed(c['value'])} toughness"
    if ctype == "ap-mod":
        return f"AP {_num_str(c['value'])}"
    if ctype == "reroll":
        ones = " 1s" if c.get("subset") == "ones" else ""
        return f"re-roll {c['roll']}{ones}"
    if ctype == "feel-no-pain":
        if c.get("scope") == "mortal":
            return f"feel no pain {_num_str(c['threshold'])}+ vs mortals"
        return f"feel no pain {_num_str(c['threshold'])}+"
    if ctype == "damage-reduction":
        return f"-{_num_str(c['value'])} damage"
    if ctype == "invulnerable-save":
        return f"{_num_str(c['threshold'])}+ invuln"
    if ctype == "crit-threshold":
        return f"critical {c['roll']} on {_num_str(c['value'])}+"
    if ctype == "ignore-modifiers":
        return f"ignore {c['roll']} modifiers"
    if ctype == "skill-mod":
        return f"{c['stat']} improved by {_num_str(c['value'])}"
    if ctype == "save-characteristic":
        return f"{_num_str(c['value'])}+ save"
    return "cover"


def _signed(n: float) -> str:
    return f"+{_num_str(n)}" if n >= 0 else _num_str(n)


def _num_str(n: Any) -> str:
    if isinstance(n, float) and n.is_integer():
        return str(int(n))
    return str(n)


def _keyword_label(ref: dict[str, Any]) -> str:
    """Render a weapon-keyword ref back to its printed form (best-effort)."""
    params = ref.get("parameters") or {}
    if ref.get("keyword_id") == "anti" and isinstance(params.get("target_keyword"), str):
        th = params.get("threshold")
        is_num = isinstance(th, (int, float)) and not isinstance(th, bool)
        suffix = f" {_num_str(th)}+" if is_num else ""
        return f"Anti-{params['target_keyword']}{suffix}"
    base = " ".join(w[0].upper() + w[1:] if w else w for w in ref.get("keyword_id", "").split("-"))
    value = params.get("value")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{base} {_num_str(value)}"
    return base


# ---------------------------------------------------------------------------
# Condition evaluator
# ---------------------------------------------------------------------------


def _is_buffed_unit(subject: Any) -> bool:
    """The buffed unit: the ability's own unit (or model), or the unit an aura is applied to."""
    return subject is None or subject in ("this-unit", "ability-unit", "this-model", "recipient")


def _condition_side(subject: Any, perspective: str) -> str | None:
    """Which unit of the attack a condition's subject names, or None for another unit."""
    if subject == "defender":
        return "target"
    if subject == "attacker":
        return "attacker"
    if _is_buffed_unit(subject):
        return "attacker" if perspective == "attacker" else "target"
    return None


def _is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _single_keyword(params: dict[str, Any] | None) -> str | None:
    """The one keyword a ``has-keyword`` names, else None."""
    all_of = params.get("all_of") if params else None
    all_of = all_of if isinstance(all_of, list) else []
    if (params or {}).get("any_of") is not None or len(all_of) != 1:
        return None
    return all_of[0] if isinstance(all_of[0], str) else None


def _matches_unit_filter(
    filt: Any,
    ctx: EngineContext,
    side: str,
    owner: str = "friendly",
) -> bool | str:
    """Evaluate only unit facts carried by the crunch context.

    ``owner`` says whose the filter is relative to the filtered unit: the ability belongs to
    ``side`` when the unit is friendly, and to the other side when it is an enemy.
    """
    if not _is_object(filt):
        return "unknown"
    ability_side = side if owner == "friendly" else ("target" if side == "attacker" else "attacker")
    unknown = False
    predicates: dict[str, list[str]] = {}
    member_side = filt.get("member_of") == "this-unit" or filt.get("member_of") == (
        "attacker" if side == "attacker" else "defender"
    )
    keywords = ctx.get("attackerKeywords" if side == "attacker" else "targetKeywords")
    for key in ("all_of", "any_of", "none_of", "not_all_of"):
        value = filt.get(key)
        if value is None:
            continue
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            return "unknown"
        predicates[key] = value
    if filt.get("level") == "model" and predicates:
        unknown = True
    if predicates:
        if not isinstance(keywords, list) or not all(isinstance(item, str) for item in keywords):
            unknown = True
        elif not unit_matches_applies_to(predicates, keywords):
            return False
    for key, value in filt.items():
        if key in predicates:
            continue
        if key == "owner":
            if value != "any" and value != owner:
                return False
        elif key == "unit_ids":
            if (
                filt.get("level") != "unit"
                or not isinstance(value, list)
                or not value
                or not all(isinstance(unit_id, str) for unit_id in value)
            ):
                return "unknown"
            identity = ctx.get("attackerUnitId" if side == "attacker" else "targetUnitId")
            if not isinstance(identity, str):
                unknown = True
            elif identity not in value:
                return False
        elif key == "any_of_filters":
            if not isinstance(value, list) or not value:
                return "unknown"
            results = [_matches_unit_filter(item, ctx, side, owner) for item in value]
            if True not in results:
                if "unknown" not in results:
                    return False
                unknown = True
        elif key == "state" and value == "benefit-of-cover":
            covered = ctx.get("attackerInCover" if side == "attacker" else "targetInCover")
            if covered is False:
                return False
            if covered is None:
                unknown = True
        elif key == "state" and value == "on-battlefield":
            continue
        elif key == "state" and value in ("in-strategic-reserves", "in-cult-ambush"):
            return False
        elif key == "state" and isinstance(value, str) and value in _LISTED_STATES:
            states = ctx.get("attackerStates" if side == "attacker" else "targetStates")
            if states is None:
                unknown = True
            elif value not in states:
                return False
        elif key == "designated" and isinstance(value, str):
            designations = ctx.get(
                "attackerDesignations" if side == "attacker" else "targetDesignations"
            )
            if designations is None:
                unknown = True
            elif not any(d.lower() == value.lower() for d in designations):
                return False
        elif (
            key == "within"
            and _is_object(value)
            and value.get("wholly") is not True
            and _is_object(value.get("of"))
            and _is_object(value["of"].get("objective"))
        ):
            verdict = (
                _within_objective(
                    value["of"]["objective"],
                    ctx.get("attackerObjectives" if side == "attacker" else "targetObjectives"),
                    ability_side,
                )
                if value.get("range") == "objective-control"
                else "unknown"
            )
            if verdict is False:
                return False
            if verdict == "unknown":
                unknown = True
        elif (
            key == "within"
            and _is_object(value)
            and value.get("wholly") is not True
            and (
                (side == "attacker" and value.get("of") == "defender")
                or (side == "target" and value.get("of") == "attacker")
                or (value.get("of") in ("this-unit", "ability-unit") and ability_side != side)
            )
        ):
            range_ref = value.get("range")
            if range_ref == "half-weapon":
                half_range = ctx.get("withinHalfRange")
                if half_range is False:
                    return False
                if half_range is not True:
                    unknown = True
                continue
            if (
                _is_object(range_ref)
                and isinstance(range_ref.get("per_battle_round"), list)
                and isinstance(ctx.get("battleRound"), (int, float))
                and not isinstance(ctx.get("battleRound"), bool)
            ):
                tiers = range_ref["per_battle_round"]
                index = max(int(ctx["battleRound"]) - 1, 0)
                range_ref = tiers[min(index, len(tiers) - 1)] if tiers else None
            inches = range_ref.get("inches") if _is_object(range_ref) else None
            distance = ctx.get("distanceInches")
            if (
                not isinstance(inches, (int, float))
                or isinstance(inches, bool)
                or not isinstance(distance, (int, float))
                or isinstance(distance, bool)
            ):
                unknown = True
            elif distance > inches:
                return False
        elif key == "level" and value == "unit":
            continue
        elif (
            key == "level"
            and value == "model"
            and filt.get("attachment_role") is not None
            and member_side
        ):
            continue
        elif key == "attachment_role" and filt.get("level") == "model" and member_side:
            role = ctx.get(
                "attackerAttachmentRole" if side == "attacker" else "targetAttachmentRole"
            )
            if role is None:
                unknown = True
            elif role != value:
                return False
        elif key == "member_of" and member_side and filt.get("attachment_role") is not None:
            continue
        else:
            unknown = True
    return "unknown" if unknown else True


#: States the context lists per unit; the rest are fixed for a unit in an attack, or unknown.
_LISTED_STATES = frozenset(("engaged", "battle-shocked", "hidden"))


def _within_objective(filt: dict[str, Any], objectives: Any, ability_side: str) -> bool | str:
    """Whether one of the unit's objectives meets every property of an objective filter.

    Ownership and territory are read from the ability's side.
    """
    if objectives is None:
        return "unknown"
    other = "target" if ability_side == "attacker" else "attacker"

    def side_of(relative: Any) -> str | None:
        if relative == "friendly":
            return ability_side
        if relative == "enemy":
            return other
        return None

    unknown = False
    for objective in objectives:
        verdict: bool | str = True
        for key, wanted in filt.items():
            holds: bool | str
            if key == "controlled_by":
                controller = objective.get("controller")
                if controller is None:
                    holds = "unknown"
                elif wanted == "any":
                    holds = controller != "none"
                elif side_of(wanted) is None:
                    holds = "unknown"
                else:
                    holds = controller == side_of(wanted)
            elif key == "designated" and isinstance(wanted, str):
                designations = objective.get("designations")
                holds = (
                    "unknown"
                    if designations is None
                    else any(d.lower() == wanted.lower() for d in designations)
                )
            elif key == "role":
                role = objective.get("role")
                holds = "unknown" if role is None else role == wanted
            elif key == "home_of":
                home_of = objective.get("homeOf")
                holds = (
                    "unknown"
                    if home_of is None or side_of(wanted) is None
                    else home_of == side_of(wanted)
                )
            elif key == "territory":
                territory = (
                    ability_side
                    if wanted == "your-territory"
                    else other
                    if wanted == "enemy-territory"
                    else "no-mans-land"
                    if wanted == "no-mans-land"
                    else None
                )
                actual = objective.get("territory")
                holds = "unknown" if actual is None or territory is None else actual == territory
            elif key == "name":
                name = objective.get("name")
                holds = "unknown" if name is None else name == wanted
            else:
                holds = "unknown"
            if holds is False:
                verdict = False
                break
            if holds == "unknown":
                verdict = "unknown"
        if verdict is True:
            return True
        if verdict == "unknown":
            unknown = True
    return "unknown" if unknown else False


def _evaluate_condition(
    condition: dict[str, Any],
    ctx: EngineContext,
    perspective: str = "attacker",
    source: BuffSource | None = None,
) -> Any:
    # Compound conditions use {operator, operands}; dispatch on shape.
    if isinstance(condition.get("operator"), str) and isinstance(condition.get("operands"), list):
        return _evaluate_compound(
            condition["operator"], condition["operands"], ctx, perspective, source
        )
    ctype = condition.get("type")
    params = condition.get("parameters") if _is_object(condition.get("parameters")) else None
    if ctype == "phase-is":
        wanted = params.get("phase") if params else None
        if not isinstance(wanted, str):
            return "unknown"
        return ctx.get("phase") == wanted
    if ctype == "attack-is":
        if any(k != "attack_type" for k in (params or {})):
            return "unknown"
        attack_type = params.get("attack_type") if params else None
        if attack_type == "melee":
            return ctx.get("phase") == "fight"
        if attack_type == "ranged":
            return ctx.get("phase") == "shooting"
        return "unknown"
    if ctype == "timing-is":
        wanted = params.get("timing") if params else None
        if not isinstance(wanted, str):
            return "unknown"
        if ctx.get("timing") is None:
            return "unknown"
        return ctx["timing"] == wanted
    if ctype == "happened":
        p = params or {}
        filt = p.get("filter")
        types = filt.get("move_types") if _is_object(filt) else None
        types = types if isinstance(types, list) else []
        count = p.get("count")
        own = (
            p.get("subject") is None
            and p.get("object") is None
            and (count is None or count == {"min": 1, "max": 1})
            and p.get("window") == "turn"
        )
        if (
            not own
            or p.get("event") != "move-ended"
            or len(types) != 1
            or not _is_object(filt)
            or len(filt) != 1
        ):
            return "unknown"
        # Player-controlled context flags for the buffed unit's own move this turn. An undefined
        # charge flag means the caller couldn't pin it down: stay "unknown" so the SPA surfaces it.
        if types[0] == "remain-stationary":
            return ctx.get("attackerStationary") is True
        if types[0] == "charge":
            charged = ctx.get("attackerCharged")
            return "unknown" if charged is None else charged
        return "unknown"
    if ctype == "has-keyword":
        p = params or {}
        # A keyword the player picked is not in the context.
        if p.get("chosen_by") is not None:
            return "unknown"
        subject = p.get("subject")
        if subject == "defender":
            pool = ctx.get("targetKeywords")
        elif _is_buffed_unit(subject):
            pool = ctx.get("attackerKeywords")
        else:
            return "unknown"
        have = [k.lower() for k in (pool or [])]
        raw_all, raw_any = p.get("all_of"), p.get("any_of")
        all_of: list[Any] = raw_all if isinstance(raw_all, list) else []
        any_of: list[Any] = raw_any if isinstance(raw_any, list) else []
        if not all(isinstance(k, str) for k in [*all_of, *any_of]):
            return "unknown"
        return all(k.lower() in have for k in all_of) and (
            len(any_of) == 0 or any(k.lower() in have for k in any_of)
        )
    if ctype == "matches":
        p = params or {}
        side = _condition_side(p.get("subject"), perspective)
        if side is None:
            return "unknown"
        # Ownership is relative to the side whose ability it is.
        own_side = "attacker" if perspective == "attacker" else "target"
        return _matches_unit_filter(
            p.get("filter"), ctx, side, "friendly" if side == own_side else "enemy"
        )
    if ctype == "army-faction":
        faction = params.get("faction") if params else None
        if not isinstance(faction, str) or ctx.get("armyFaction") is None:
            return "unknown"
        return ctx["armyFaction"] == faction
    if ctype == "model-count":
        # "contains N or more models": min and max are inclusive. A keyword-restricted
        # count needs per-keyword model counts the context does not carry.
        p = params or {}
        if p.get("keyword") is not None:
            return "unknown"
        side = _condition_side(p.get("subject"), perspective)
        if side is None:
            return "unknown"
        count = ctx.get("attackerModelCount" if side == "attacker" else "targetModelCount")
        if count is None:
            return "unknown"
        minimum, maximum = p.get("min"), p.get("max")
        if isinstance(minimum, int) and count < minimum:
            return False
        if isinstance(maximum, int) and count > maximum:
            return False
        return True
    if ctype == "battle-size":
        size = params.get("size") if params else None
        if not isinstance(size, str) or ctx.get("battleSize") is None:
            return "unknown"
        return ctx["battleSize"] == size
    if ctype == "battle-round":
        p = params or {}
        battle_round = ctx.get("battleRound")
        if not _is_num(battle_round):
            return "unknown"
        if _is_num(p.get("min")) and battle_round < p["min"]:
            return False
        if _is_num(p.get("max")) and battle_round > p["max"]:
            return False
        return True
    if ctype == "player-turn-is":
        # "Your turn" is the turn of the player whose ability it is.
        turn = params.get("turn") if params else None
        attacker_turn = ctx.get("attackerTurn")
        if turn not in ("your-turn", "opponent-turn") or not isinstance(attacker_turn, bool):
            return "unknown"
        yours = attacker_turn if perspective == "attacker" else not attacker_turn
        return yours if turn == "your-turn" else not yours
    if ctype == "strength":
        p = params or {}
        side = _condition_side(p.get("subject"), perspective)
        strength = (
            ctx.get("attackerStrength" if side == "attacker" else "targetStrength")
            if side is not None
            else None
        )
        below = p.get("below")
        if strength is None or below not in ("starting", "half"):
            return "unknown"
        return strength == "below-half" if below == "half" else strength != "full"
    if ctype == "wounds":
        # Each listed property must hold; the Damaged bracket needs datasheet data the
        # context lacks.
        p = params or {}
        side = _condition_side(p.get("subject"), perspective)
        wounds = (
            ctx.get("attackerWounds" if side == "attacker" else "targetWounds")
            if side is not None
            else None
        )
        if wounds is None:
            return "unknown"
        unknown = "damaged" in p
        if p.get("lost") is True and wounds["remaining"] >= wounds["starting"]:
            return False
        if "remaining_max" in p:
            if not _is_num(p["remaining_max"]):
                unknown = True
            elif wounds["remaining"] > p["remaining_max"]:
                return False
        return "unknown" if unknown else True
    if ctype == "closest":
        # Only "the target is the closest eligible target to the attacker" is in the context.
        p = params or {}
        to = p.get("to")
        to_attacker = (
            to is None or to == "attacker" or (perspective == "attacker" and _is_buffed_unit(to))
        )
        if (
            _condition_side(p.get("subject"), perspective) != "target"
            or p.get("among") != "eligible-targets"
            or not to_attacker
        ):
            return "unknown"
        closest = ctx.get("targetClosest")
        if closest is None:
            return "unknown"
        if not closest:
            return False
        if "range" not in p:
            return True
        range_ref = p["range"]
        distance = ctx.get("distanceInches")
        if not _is_object(range_ref) or not _is_num(range_ref.get("inches")) or distance is None:
            return "unknown"
        return distance <= range_ref["inches"]
    if ctype == "guided":
        # Guided is read for the attacking unit: a For the Greater Good unit, not an
        # Observer, targeting a Spotted unit.
        subject = params.get("subject") if params else None
        if (subject is not None and not _is_buffed_unit(subject)) or ctx.get(
            "attackerGuided"
        ) is None:
            return "unknown"
        return ctx["attackerGuided"]
    if ctype == "attachment":
        p = params or {}
        if p.get("with") is not None:
            return "unknown"
        subject = p.get("subject")
        explicit_side = (
            "attacker" if subject == "attacker" else "target" if subject == "defender" else None
        )
        if explicit_side is None and subject not in (
            None,
            "this-model",
            "this-unit",
            "ability-unit",
        ):
            return "unknown"
        side = explicit_side or ("attacker" if perspective == "attacker" else "target")
        attached = ctx.get("attackerAttached" if side == "attacker" else "targetAttached")
        role = ctx.get("attackerAttachmentRole" if side == "attacker" else "targetAttachmentRole")
        if (
            explicit_side is None
            and source is not None
            and source.get("kind") == "ability"
            and source.get("abilityKind") in ("attached", "support")
        ):
            source_id = source.get("sourceUnitId")
            roles = ctx.get("attachmentRoles")
            role = roles.get(source_id) if _is_object(roles) and source_id is not None else None
            attached = True if source.get("abilityKind") == "attached" else role is not None
        if attached is False:
            return False
        wanted_role = p.get("role")
        if wanted_role == "attached":
            return "unknown" if attached is None else attached
        if wanted_role == "leading":
            return "unknown" if role is None else role == "leader"
        if wanted_role == "led" and role == "bodyguard":
            return True
        return "unknown"
    return "unknown"


def _evaluate_compound(
    operator: str,
    operands: list[Any],
    ctx: EngineContext,
    perspective: str,
    source: BuffSource | None,
) -> Any:
    """Kleene three-valued evaluator for compound conditions. ``and``
    short-circuits to False on any false operand; ``or`` to True
    symmetrically; ``not`` flips its single operand. Unknown operands that
    don't get short-circuited propagate as ``"unknown"``."""
    if operator == "not":
        first = operands[0] if operands else None
        if not _is_object(first):
            return "unknown"
        v = _evaluate_condition(first, ctx, perspective, source)
        if v == "unknown":
            return "unknown"
        return not v
    if operator not in ("and", "or"):
        return "unknown"
    saw_unknown = False
    for operand in operands:
        if not _is_object(operand):
            saw_unknown = True
            continue
        v = _evaluate_condition(operand, ctx, perspective, source)
        if v == "unknown":
            saw_unknown = True
            continue
        if operator == "and" and v is False:
            return False
        if operator == "or" and v is True:
            return True
    if saw_unknown:
        return "unknown"
    return operator == "and"  # all true for AND, all false for OR


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _js_str(v: Any) -> str:
    """JS ``String(x)`` for the values that flow into reason strings."""
    if v is None:
        return "undefined"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _js_number(v: Any) -> float:
    """JS ``Number()`` semantics for the inputs that occur here.

    Note ``null`` → 0 in JS, but a missing key → NaN; dict.get can't tell
    them apart, so absent-or-null both map to NaN (the data never carries an
    explicit null in these positions)."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip()) if v.strip() else 0.0
        except ValueError:
            return math.nan
    return math.nan


def _intify(n: float) -> Any:
    """Collapse integral floats back to int so JSON round-trips match TS
    (JS has one number type; 5.0 serializes as 5)."""
    if isinstance(n, float) and n.is_integer():
        return int(n)
    return n


def _signed_value(modifier: dict[str, Any]) -> Any:
    """Read a signed numeric value out of a modifier ``{operation, value}``
    pair. "add"/"improve" keep the sign; "subtract"/"worsen" negate; anything
    else returns None (surfaced as unsupported)."""
    value = _js_number(modifier.get("value"))
    if not math.isfinite(value):
        return None
    operation = modifier.get("operation")
    if operation in ("add", "improve"):
        return _intify(value)
    if operation in ("subtract", "worsen"):
        return _intify(-value)
    # set / halve / multiply: not a single signed delta — left unsupported.
    return None


def _ap_delta(modifier: dict[str, Any]) -> Any:
    """Read the AP delta out of a stat-modifier. AP is stored negative (more
    negative = more piercing), so "improve" makes it more negative and
    "worsen" less; the legacy add/subtract forms pass the signed value
    through."""
    value = _js_number(modifier.get("value"))
    if not math.isfinite(value):
        return None
    operation = modifier.get("operation")
    if operation == "improve":
        return _intify(-abs(value))
    if operation == "worsen":
        return _intify(abs(value))
    if operation == "add":
        return _intify(value)
    if operation == "subtract":
        return _intify(-value)
    return None


_FIDELITY_BINDING_REASON = (
    "selection/history/model/attack predicates are not resolved by the buff engine"
)

_ALTERNATIVES_REASON = (
    "unit-filter alternatives (any_of_filters): the unit's keywords are unavailable "
    "or an alternative names more than keywords"
)


def _keyword_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(k, str) and k for k in value)


def _alternatives_match(node: dict[str, Any], opts: dict[str, Any]) -> bool | str:
    """Whether a unit-filter target with ``any_of_filters`` reaches the unit crunched.

    True when any alternative matches, False when none can, "unknown" when the keywords are
    missing or an alternative whose keywords hold also names something else (a state). A
    friendly filter is read against the crunched side's own keywords; an enemy one only from the
    target's perspective. Nodes without alternatives are left to the target classification.
    """
    target = node.get("target")
    if not _is_object(target) or not isinstance(target.get("any_of_filters"), list):
        return True
    if target.get("owner") == "friendly":
        key = "attackerKeywords" if opts["perspective"] == "attacker" else "targetKeywords"
    elif target.get("owner") == "enemy" and opts["perspective"] == "target":
        key = "targetKeywords"
    else:
        return True
    keywords = opts["context"].get(key)
    if not _keyword_list(keywords):
        return "unknown"
    have = {keyword.lower() for keyword in keywords}
    saw_unknown = False
    for alternative in target["any_of_filters"]:
        matched = _alternative_matches(alternative, have)
        if matched is True:
            return True
        if matched == "unknown":
            saw_unknown = True
    return "unknown" if saw_unknown else False


def _alternative_matches(alternative: Any, have: set[str]) -> bool | str:
    """One alternative: False when its keyword fields fail, whatever else it names; True when they
    hold and it names nothing else; "unknown" when they hold but it also names something else (a
    state), or a keyword field is malformed."""
    if not _is_object(alternative):
        return "unknown"
    other = False
    for key, value in alternative.items():
        if key in ("all_of", "any_of", "none_of"):
            if not _keyword_list(value):
                return "unknown"
        else:
            other = True
    any_of = alternative.get("any_of")
    holds = (
        all(k.lower() in have for k in alternative.get("all_of", []))
        and (any_of is None or any(k.lower() in have for k in any_of))
        and not any(k.lower() in have for k in alternative.get("none_of", []))
    )
    if not holds:
        return False
    return "unknown" if other else True


_SELECTOR_FIDELITY_FIELDS = (
    "eligibility",
    "reference",
    "origin",
    "limit",
    "bind_as",
)


def _trigger_has_unresolved_source(trigger: Any) -> bool:
    if not _is_object(trigger):
        return False
    filt = trigger.get("filter")
    by = filt.get("by") if _is_object(filt) else None
    return by is not None or trigger.get("source_ability") is not None


def _has_unresolved_fidelity_binding(node: dict[str, Any]) -> bool:
    selector = node.get("selector") or {}
    applies = node.get("applies") or {}
    modifier = node.get("modifier") or {}
    consumer = modifier.get("consumer") or {}
    node_type = node.get("type")
    selection_binding = node_type in ("select-units", "for-each-unit") and (
        isinstance(selector.get("filter"), dict)
        and (
            selector["filter"].get("level") == "model"
            or selector["filter"].get("model_names") is not None
            or any(selector.get(key) is not None for key in _SELECTOR_FIDELITY_FIELDS)
        )
    )
    # A designation's own selection (range, visibility, eligibility) is what its
    # lever's player vouches for, so only the `applies` bindings are unresolved.
    designation_binding = node_type == "designate-target" and (
        applies.get("attacker_keywords") is not None
        or applies.get("attacker_unit_keywords") is not None
        or applies.get("beneficiary") is not None
        or applies.get("reference") is not None
    )
    trigger_value = node.get("trigger")
    triggers = trigger_value if isinstance(trigger_value, list) else [trigger_value]
    source_binding = node_type == "ability-part" and any(
        _trigger_has_unresolved_source(trigger) for trigger in triggers
    )
    return (
        selection_binding
        or designation_binding
        or source_binding
        or (node_type == "named-region-state" and consumer.get("attack_condition") is not None)
    )
