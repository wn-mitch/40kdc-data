"""Whether an unsupported fragment of an ability could change the attack being crunched.

The buff layer reports every fragment it cannot turn into a buff; most of those (movement,
deployment, objectives, tests, resources) have no damage content at all, and some act through
events outside the attack (deaths, mortal wounds, healing). Only an ``unresolved`` fragment is a gap
in what the engine scores. Mirrors TS ``cruncher/unsupported-scope.ts``.

- ``out-of-scope``: no damage content for this attack;
- ``encounter-layer``: acts outside the attack (deaths, mortal wounds, healing, designations, or a
  moment after the unit's own attacks);
- ``unresolved``: could change the attack's damage, but the engine cannot evaluate it.
"""

from __future__ import annotations

import re
from typing import Any

OUT_OF_SCOPE = "out-of-scope"
ENCOUNTER_LAYER = "encounter-layer"
UNRESOLVED = "unresolved"

_SCOPE_RANK = {OUT_OF_SCOPE: 0, ENCOUNTER_LAYER: 1, UNRESOLVED: 2}


def wider_scope(a: str, b: str) -> str:
    """The more consequential of two scopes."""
    return a if _SCOPE_RANK[a] >= _SCOPE_RANK[b] else b


#: Rolls and characteristics the hit/wound/save/damage math reads.
DAMAGE_ROLLS = frozenset(["hit", "wound", "save", "damage"])
DAMAGE_STATS = frozenset(["A", "S", "T", "Sv", "AP", "D", "WS", "BS"])

#: Leaf effect types that change no attack's damage. A type not reviewed stays a gap.
NON_DAMAGE_EFFECT_TYPES = frozenset(
    [
        "heal", "move", "mortal-wounds", "set-up", "permission", "cost-modifier",
        "stance-selection-capacity", "move-modifier", "army-rule", "keyword-grant", "act-on-death",
        "cp-gain", "resource-gain", "add-unit", "split-unit", "transport-capacity",
        "destroy-models", "designate", "test", "targeting", "state-change", "no-effect",
        "oath-modifier", "objective-sticky", "counts-as", "marker", "test-exemption",
        "return-models",
    ]
)

#: Of the non-damage leaf types, those that act through events outside the attack.
ENCOUNTER_EFFECT_TYPES = frozenset(
    ["mortal-wounds", "act-on-death", "designate", "heal", "destroy-models", "return-models"]
)

#: Core abilities (and Reanimation Protocols) that decide deployment, movement, fight order,
#: attachment or resurrection; none changes a hit, wound, save or damage roll.
NON_DAMAGE_ABILITIES = frozenset(
    [
        "deadly-demise", "deep-strike", "fights-first", "hover", "infiltrators", "leader",
        "lone-operative", "scouts", "support", "super-heavy-walker", "mobile",
        "reanimation-protocols",
    ]
)

#: Of those, the ones that act on a death or bring models back.
ENCOUNTER_ABILITIES = frozenset(["deadly-demise", "reanimation-protocols"])

_STAT_MODIFIER_OUTSIDE = re.compile(r'^stat-modifier on ".*" is outside the damage path\Z')
_ROLL_MODIFIER_OUTSIDE = re.compile(r'^roll-modifier on ".*" is outside the damage path\Z')
_REROLL_OUTSIDE = re.compile(r'^re-roll on ".*" \(subset ".*"\) is outside the damage path\Z')
_OBJECTIVE_SELECTION = re.compile(r"^select-objective: ")
_DEFENDER_SIDE_STAT = re.compile(
    r": defender-side stat; applies when the buffed unit is the target\Z"
)
_ATTACHED_MODEL_SCOPED = re.compile(r"^model-scoped effect from an attached model")
#: A condition the context cannot decide; its scope is the scope of what it gates.
UNDECIDED_CONDITION = re.compile(r"^conditional: cannot evaluate condition ")


def _ability_scope(ability_id: Any) -> str:
    if not isinstance(ability_id, str) or ability_id not in NON_DAMAGE_ABILITIES:
        return UNRESOLVED
    return ENCOUNTER_LAYER if ability_id in ENCOUNTER_ABILITIES else OUT_OF_SCOPE


def effect_scope(node: Any) -> str:
    """The scope of an effect subtree: the widest scope among its leaves. Any leaf or container
    not recognised here is ``unresolved``, the conservative default."""
    if node is None:
        return OUT_OF_SCOPE
    if not isinstance(node, dict):
        return UNRESOLVED
    raw_modifier = node.get("modifier")
    modifier: dict[str, Any] = raw_modifier if isinstance(raw_modifier, dict) else {}

    def widest(children: list[Any]) -> str:
        scope = OUT_OF_SCOPE
        for child in children:
            scope = wider_scope(scope, effect_scope(child))
        return scope

    node_type = node.get("type")
    if node_type in ("sequence", "rules-bundle"):
        steps = node.get("steps")
        return widest(steps) if isinstance(steps, list) else UNRESOLVED
    if node_type == "conditional":
        if "else" not in node:
            return widest([node.get("effect")])
        return widest([node.get("effect"), node["else"]])
    if node_type in ("select-units", "for-each-unit", "ability-part"):
        return effect_scope(node.get("effect"))
    if node_type == "dice-gated":
        return widest([node.get("on_success"), node.get("on_fail")])
    if node_type == "dice-table":
        outcomes = node.get("outcomes")
        if not isinstance(outcomes, list):
            return UNRESOLVED
        return widest([o.get("effect") if isinstance(o, dict) else None for o in outcomes])
    if node_type in ("roll-result", "roll-modifier", "re-roll"):
        roll = modifier.get("roll")
        return OUT_OF_SCOPE if isinstance(roll, str) and roll not in DAMAGE_ROLLS else UNRESOLVED
    if node_type == "stat-modifier":
        stat = modifier.get("stat")
        return OUT_OF_SCOPE if isinstance(stat, str) and stat not in DAMAGE_STATS else UNRESOLVED
    if node_type == "ability-grant":
        # A printed grant is judged by the body it carries.
        if "definition" in modifier:
            return effect_scope(modifier["definition"])
        return _ability_scope(modifier.get("ability"))
    if node_type == "ability-activate":
        return _ability_scope(modifier.get("ability"))
    if node_type == "rule-state":
        if modifier.get("rule_kind") == "ability":
            return _ability_scope(modifier.get("rule"))
        if (
            modifier.get("rule_kind") == "core-rule"
            and modifier.get("rule") == "attacking-ends-hidden"
        ):
            return OUT_OF_SCOPE
        return UNRESOLVED
    # An aura's range only decides which units are in it; a use count never changes an attack.
    if node_type == "ability-modifier":
        return OUT_OF_SCOPE if modifier.get("aspect") in ("uses", "range") else UNRESOLVED
    if not isinstance(node_type, str) or node_type not in NON_DAMAGE_EFFECT_TYPES:
        return UNRESOLVED
    return ENCOUNTER_LAYER if node_type in ENCOUNTER_EFFECT_TYPES else OUT_OF_SCOPE


def _labelled_outside_damage_path(reason: str, fragment: Any) -> bool | None:
    """Whether the translator's "outside the damage path" label holds; None when the reason is not
    one of those labels."""
    raw = fragment.get("modifier") if isinstance(fragment, dict) else None
    modifier: dict[str, Any] = raw if isinstance(raw, dict) else {}
    if _STAT_MODIFIER_OUTSIDE.match(reason):
        stat = modifier.get("stat")
        return not isinstance(stat, str) or stat not in DAMAGE_STATS
    if _ROLL_MODIFIER_OUTSIDE.match(reason) or _REROLL_OUTSIDE.match(reason):
        roll = modifier.get("roll")
        return not isinstance(roll, str) or roll not in DAMAGE_ROLLS
    return None


def fragment_scope(reason: str, fragment: Any, post_attack_moment: str) -> str:
    """The scope of one unsupported fragment from its reason and effect fragment. An undecided
    condition is classified by the caller, which can translate its body; here it is unresolved."""
    labelled = _labelled_outside_damage_path(reason, fragment)
    if labelled is not None:
        return OUT_OF_SCOPE if labelled else UNRESOLVED
    if reason == post_attack_moment:
        return ENCOUNTER_LAYER
    if (
        _OBJECTIVE_SELECTION.match(reason)
        or _DEFENDER_SIDE_STAT.search(reason)
        or _ATTACHED_MODEL_SCOPED.match(reason)
    ):
        return OUT_OF_SCOPE
    if UNDECIDED_CONDITION.match(reason):
        return UNRESOLVED
    return effect_scope(fragment)
