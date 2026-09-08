"""Humanize an Ability-DSL / scoring ``condition`` into plain English.

Shared by the effect describer and the scoring-card translator. Output is
**ASCII-only** with a fixed clause and parameter order: it is pinned
byte-for-byte across the TS, Rust, and Python ports by the
``conformance/scoring-translation`` corpus, so any phrasing change here is a
semantic corpus change (bump ``conformance/SPEC_VERSION``).

Python mirror of ``tools/src/translate/condition.ts``.
"""

from __future__ import annotations

from typing import Any

Condition = dict[str, Any]


def dekebab(s: str) -> str:
    """kebab-case → space-separated words (``enemy-territory`` → ``enemy territory``)."""
    return s.replace("-", " ")


def _str(v: Any) -> str:
    """TS ``str``: null/undefined → "?", else JS ``String(v)``."""
    if v is None:
        return "?"
    if isinstance(v, str):
        return v
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _count(n: Any, noun: str) -> str:
    """``2`` + ``objective`` → ``2+ objectives``. All regular plurals here."""
    return f"{_str(n)}+ {noun}s"


def _or_list(items: list[str]) -> str:
    """Oxford-free disjunction matching the TypeScript condition renderer."""
    if len(items) <= 1:
        return items[0] if items else ""
    if len(items) == 2:
        return f"{items[0]} or {items[1]}"
    return f"{', '.join(items[:-1])} or {items[-1]}"


def _round_number(v: Any) -> float | int | None:
    """JS ``Number(v)`` collapsing integral floats to int; None on non-numeric."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


_BATTLE_ROUND_ORDS = ["zeroth", "first", "second", "third", "fourth", "fifth"]


def _battle_round_ord(n: float | int) -> str:
    """Ordinal name for a battle round (``["zeroth"..."fifth"][n] ?? "<n>th"``)."""
    if isinstance(n, int) and 0 <= n < len(_BATTLE_ROUND_ORDS):
        return _BATTLE_ROUND_ORDS[n]
    return f"{_str(n)}th"


# Legacy ``timing-is`` tokens → canonical ``game-event`` keys. The alias map keeps
# un-migrated strings rendering identically through the one vocabulary
# (``event_clause`` / ``_EVENT_PHRASES``). Mirrors TS TIMING_ALIASES.
_TIMING_ALIASES: dict[str, str] = {
    "advance": "advances",
    "after-attacks": "after-unit-resolves-attacks",
    "after-attacking-unit-finishes-attacks": "after-unit-resolves-attacks",
    "after-shooting": "after-unit-resolves-attacks",
    "after-unit-shot": "after-unit-resolves-attacks",
    "after-unit-has-shot": "after-unit-resolves-attacks",
    "after-this-model-has-shot": "after-unit-resolves-attacks",
    "after-shot-hits-scored": "after-scoring-hit",
    "deep-strike": "deep-strike-setup",
    "end": "end-of-turn",
    "start": "start-of-turn",
    "fall-back": "falls-back",
    "model-destroyed": "on-model-destroyed",
    "on-destroyed": "on-unit-destroyed",
    "before-this-model-removed": "before-bearer-removed",
    "reinforcements-step": "reinforcements",
    "setup": "unit-set-up",
    "set-up-this-turn": "unit-set-up",
    "after-move-through-terrain-over-4-inches": "moved-through-tall-terrain",
    "after-moving-through-tall-terrain": "moved-through-tall-terrain",
    "when-selected-to-shoot": "selected-to-shoot",
    "when-this-unit-selected-to-shoot": "selected-to-shoot",
}

# Timing strings with no canonical ``game-event`` equivalent but an established
# phrase: usage markers and a couple of phase/state gates. Mirrors TS
# TIMING_ONLY_PHRASES.
_TIMING_ONLY_PHRASES: dict[str, str] = {
    "once-per-battle": "once per battle",
    "once-per-phase": "once per phase",
    "once-per-opponent-turn": "once per opponent's turn",
    "first-this-battle": "the first time this battle",
    "first-time-this-phase": "the first time this phase",
    "in-reserves": "while it is in Reserves",
    "command-phase": "during the Command phase",
    "shooting-phase": "in the Shooting phase",
    "start-of-fight-phase": "at the start of the Fight phase",
    "first-movement-phase": "in your first Movement phase",
    "start-of-first-battle-round": "at the start of the first battle round",
    "start-of-movement-phase": "at the start of the Movement phase",
    "start-of-shooting-phase": "at the start of your Shooting phase",
    "shooting-or-fight-phase": "in the Shooting or Fight phase",
    "this-model-starts-or-ends-a-move": "each time this model starts or ends a move",
    "end-of-normal-move": "when the unit ends a Normal move",
    "friendly-unit-empowered-within-9": (
        'each time you spend 1 Pain token to Empower a friendly unit within 9" of this unit'
    ),
    "enemy-unit-fails-battle-shock": "each time an enemy unit fails a Battle-shock test",
    "enemy-unit-destroyed": "each time an enemy unit is destroyed",
}


def describe_timing(timing: Any) -> str:
    """A ``timing-is`` event → natural GW-voice clause, delegating to the canonical
    ``_EVENT_PHRASES`` vocabulary via the alias map (no doubled prepositions)."""
    t = _str(timing)
    if t in _TIMING_ONLY_PHRASES:
        return _TIMING_ONLY_PHRASES[t]
    canon = _TIMING_ALIASES.get(t, t)
    if canon in _EVENT_PHRASES:
        return _EVENT_PHRASES[canon]
    if t.startswith("after-"):
        return f"after {dekebab(t[6:])}"
    if t.startswith("on-"):
        return f"when {dekebab(t[3:])}"
    if t.endswith("-destroyed"):
        return f"each time {dekebab(t)}"
    return f"at {dekebab(t)}"


def negated_timing(timing: Any) -> str:
    """``timing-is`` negation, generic over every ``describe_timing`` phrase: a
    ``when ...`` clause becomes ``unless ...``; anything else is bare-prepended
    with ``unless ``. Mirrors the TS ``negatedTiming`` helper."""
    phrase = describe_timing(timing)
    if phrase.startswith("when "):
        return f"unless {phrase[5:]}"
    return f"unless {phrase}"


# Canonical ``game-event`` token → natural clause, for the reactive ``trigger.event``.
# Unmapped events degrade to ``when <dekebab>``. Mirrors TS EVENT_PHRASES.
_EVENT_PHRASES: dict[str, str] = {
    "start-of-phase": "at the start of the phase",
    "end-of-phase": "at the end of the phase",
    "start-of-turn": "at the start of the turn",
    "charge-declaration": "when a Charge is declared",
    "end-of-turn": "at the end of the turn",
    "start-of-opponent-turn": "at the start of the opponent's turn",
    "end-of-opponent-turn": "at the end of the opponent's turn",
    "start-of-battle-round": "at the start of the battle round",
    "start-of-battle": "at the start of the battle",
    "army-selection": "when you select this model to include in your army",
    "start-of-command-phase": "at the start of the Command phase",
    "declare-battle-formations": "when declaring Battle Formations",
    "post-deployment": "after deployment",
    "unit-set-up": "when the unit is set up",
    "set-up-from-reserves": "when the unit arrives from Reserves",
    "arrives-from-strategic-reserves": "when the unit arrives from Strategic Reserves",
    "starts-in-strategic-reserves": "if the unit starts in Strategic Reserves",
    "game-start-in-reserves": "if the unit begins the battle in Reserves",
    "deep-strike-setup": "when the unit is set up by Deep Strike",
    "reinforcements": "when the unit arrives as Reinforcements",
    "normal-move": "when the unit makes a Normal move",
    "advance-move": "when the unit makes an Advance move",
    "advances": "when the unit Advances",
    "fall-back-move": "when the unit makes a Fall Back move",
    "falls-back": "when the unit Falls Back",
    "charge-move": "when the unit makes a Charge move",
    "end-of-charge-move": "after the unit ends a Charge move",
    "moved-through-terrain": "when the unit moves through terrain",
    "moved-through-tall-terrain": 'when the unit moves through terrain over 4" tall',
    "enemy-unit-ended-move": "an enemy unit ends a move",
    "enemy-unit-fell-back": "an enemy unit Falls Back",
    "before-hit-roll": "before a Hit roll is made",
    "after-hit-roll": "after a Hit roll is made",
    "before-wound-roll": "before a Wound roll is made",
    "attack-scores-wound": "each time an attack scores a wound",
    "before-save-roll": "before a saving throw is made",
    "after-save-roll": "after a saving throw is made",
    "before-damage-roll": "before a Damage roll is made",
    "after-damage-roll": "after a Damage roll is made",
    "before-charge-roll": "before a Charge roll is made",
    "after-charge-roll": "after a Charge roll is made",
    "before-advance-roll": "before an Advance roll is made",
    "after-advance-roll": "after an Advance roll is made",
    "before-battle-shock": "before a Battle-shock test",
    "after-battle-shock": "after a Battle-shock test",
    "on-unit-selected": "when the unit is selected",
    "selected-to-shoot": "when the unit is selected to shoot",
    "selected-to-fight": "when the unit is selected to fight",
    "selected-to-advance": "when the unit is selected to Advance",
    "after-unit-resolves-attacks": "after the unit resolves its attacks",
    "after-scoring-hit": "after scoring a hit",
    "after-enemy-unit-fires": "after an enemy unit shoots",
    "on-unit-destroyed": "when the unit is destroyed",
    "on-model-destroyed": "when a model in the unit is destroyed",
    "first-model-destroyed": "the first time a model in the unit is destroyed",
    "before-bearer-removed": "before this model is removed from play",
    "enemy-unit-destroyed-in-melee": "when an enemy unit is destroyed in melee",
    "on-damage-allocated": "when damage is allocated",
    "battle-shock-test": "when the unit takes a Battle-shock test",
    "leadership-test": "when the unit takes a Leadership test",
    "desperate-escape-test": "when the unit takes a Desperate Escape test",
    "end-of-opponent-charge-phase": "at the end of the opponent's Charge phase",
    "enemy-unit-completed-shooting-targeting-bearer": "after an enemy unit has shot and targeted this unit",
    "enemy-unit-selects-bearer-as-charge-target": "when an enemy unit selects this unit as a charge target",
    "enemy-unit-targets-bearer": "when an enemy unit targets this unit",
    "enemy-unit-completed-fall-back-from-bearer": "after an enemy unit within Engagement Range of this unit completes a Fall Back move",
    "act-of-faith-completed": "after an Act of Faith is completed",
    "act-of-faith-performed": "when an Act of Faith is performed",
    "miracle-die-generated": "when a Miracle die is generated",
    "enemy-unit-selected-charge-targets-before-charge-move": "after an enemy unit selects targets for its charge but before it makes a Charge move",
}

def event_clause(event: Any) -> str:
    """A reactive ``trigger.event`` token → natural clause (unmapped → ``when <dekebab>``)."""
    e = _str(event)
    return _EVENT_PHRASES.get(e, f"when {dekebab(e)}")


def _region_membership_phrase(p: dict[str, Any], negated: bool = False) -> str:
    state_ref = p.get("state_ref")
    state_region = state_ref.get("region_id") if isinstance(state_ref, dict) else None
    raw_region = p.get("region_id", state_region)
    region = " ".join(word.capitalize() for word in dekebab(_str(raw_region)).split())
    relation = (
        "wholly within"
        if p.get("relation") == "wholly-within"
        else dekebab(_str(p.get("relation", "within")))
    )
    subject = (
        "every model in the eligible attacking unit"
        if p.get("unit_scope") == "whole-unit"
        else "the eligible attacking model"
    )
    return f"{'not ' if negated else ''}{subject} is {relation} {region}"


def describe_selection_eligibility(c: Condition) -> str:
    """Render a condition as a predicate on an already-named candidate unit."""
    if c.get("type") == "is-battle-shocked" and not c.get("operator"):
        return "that is not Battle-shocked" if c.get("negated") else "that is Battle-shocked"
    phrase = describe_condition(c)
    if phrase.startswith("the unit is "):
        return f"that is {phrase[len('the unit is ') :]}"
    if phrase.startswith("not the unit is "):
        return f"that is not {phrase[len('not the unit is ') :]}"
    if phrase.startswith("the unit has "):
        return f"with {phrase[len('the unit has ') :]}"
    return f"if {phrase}"


def describe_condition(c: Condition) -> str:
    # Compound nodes first — join the operands with lowercase connectives.
    operands = c.get("operands")
    if c.get("operator") == "and" and operands:
        return " and ".join(
            f"({describe_condition(o)})" if o.get("operator") == "or" else describe_condition(o)
            for o in operands
        )
    if c.get("operator") == "or" and operands:
        if all(not o.get("negated") and o.get("type") == "unit-has-keyword" for o in operands):
            keywords = [_str((o.get("parameters") or {}).get("keyword")) for o in operands]
            return f"the unit has the {_or_list(keywords)} keywords"
        return " or ".join(
            f"({describe_condition(o)})" if o.get("operator") == "and" else describe_condition(o)
            for o in operands
        )
    if c.get("operator") == "not" and operands:
        return f"not ({', '.join(describe_condition(o) for o in operands)})"

    negate = "not " if c.get("negated") else ""
    p = c.get("parameters") or {}
    ctype = c.get("type")

    if ctype == "target-of-triggering-charge":
        return f"{negate}the unit was selected as a target of that charge"
    if ctype == "every-model-within-range-of-bearer":
        return f'{negate}every model in the unit is within {_str(p.get("range"))}" of this Transport'
    if ctype == "roll-succeeded":
        return f"{negate}the triggering {dekebab(_str(p.get('roll')))} roll succeeded"
    if ctype == "on-battlefield":
        who = (
            f"the {_str(p.get('model_name'))} model"
            if p.get("model_name") is not None
            else "the unit"
            if p.get("subject") == "unit"
            else "the target unit"
            if p.get("subject") == "target"
            else "this model"
        )
        return f"{negate}{who} is on the battlefield"
    if ctype == "target-within-half-weapon-range":
        return f"{negate}the target is within half the attacking weapon's range"
    if ctype == "has-destroyed":
        who = (
            "the unit"
            if p.get("subject") == "unit"
            else "the target unit"
            if p.get("subject") == "target"
            else "this model"
        )
        keywords = (
            f" {' '.join(_str(keyword) for keyword in p['victim_keywords'])}"
            if isinstance(p.get("victim_keywords"), list)
            else ""
        )
        victims = _count(
            p.get("count_min") if p.get("count_min") is not None else 1,
            f"{_str(p.get('victim_owner'))}{keywords} {_str(p.get('victim_kind'))}",
        )
        window = (
            "with its just-resolved attacks"
            if p.get("window") == "just-finished-attack-sequence"
            else f"during {dekebab(_str(p.get('window')))}"
        )
        return f"{negate}{who} has destroyed {victims} {window}"
    # ── Ability-DSL conditions ───────────────────────────────────────────────
    if ctype == "phase-is":
        phase = _str(p.get("phase"))
        phase_name = "Command" if phase in ("command", "command-phase") else phase
        return f"{negate}during the {phase_name} phase"
    if ctype == "timing-is":
        timing = p.get("timing")
        return negated_timing(timing) if c.get("negated") else describe_timing(timing)
    if ctype == "player-turn-is":
        turn = p.get("turn")
        if turn in ("your-turn", "your", "own"):
            whose = "your"
        elif turn in ("opponent-turn", "opponent"):
            whose = "the opponent's"
        else:
            whose = "either player's"
        return f"{negate}in {whose} turn"
    if ctype == "charged-this-turn":
        return f"{negate}the unit charged this turn"
    if ctype == "advanced-this-turn":
        return f"{negate}the unit advanced this turn"
    if ctype == "remained-stationary":
        return f"{negate}the unit remained stationary"
    if ctype == "unit-below-starting-strength":
        return f"{negate}the unit is below starting strength"
    if ctype == "unit-below-half-strength":
        who = "target unit" if p.get("subject") == "target" else "unit"
        return f"{negate}the {who} is below half strength"
    if ctype == "unit-has-keyword":
        return f'{negate}the unit has "{_str(p.get("keyword"))}"'
    if ctype == "unit-model-count":
        return (
            f"{negate}the unit contains {_str(p.get('count_min'))}+ {_str(p.get('keyword'))} models"
        )
    if ctype == "uniform-ranged-loadout":
        keyword = f"{_str(p.get('model_keyword'))} " if p.get("model_keyword") else ""
        return (
            f"{negate}all ranged weapons equipped by each {keyword}model in the unit are the same"
        )
    if ctype == "all-attacks-target-same-unit":
        attack_type = f"{_str(p.get('attack_type'))} " if p.get("attack_type") else ""
        return f"{negate}all of the unit's {attack_type}attacks target the same enemy unit"
    if ctype == "target-has-keyword":
        return f'{negate}the target has "{_str(p.get("keyword"))}"'
    if ctype == "model-is-leader":
        return f"{negate}the model is leading a unit"
    if ctype == "unit-is-led-by":
        return f"{negate}this unit is being led by an {_str(p.get('keyword'))} model"
    if ctype == "is-attached":
        kw = f"{_str(p.get('keyword'))} " if p.get("keyword") else ""
        return f"{negate}the model is leading a {kw}unit"
    if ctype == "attack-is-type":
        if p.get("comparison") == "strength-greater-than-toughness":
            return f"{negate}when this attack's Strength is greater than the target's Toughness"
        if p.get("comparison") is not None:
            return f"{negate}when {dekebab(_str(p.get('comparison')))}"
        return f"{negate}for {_str(p.get('attack_type'))} attacks"
    if ctype == "unit-selected-to-shoot-this-phase":
        return f"{negate}the unit has been selected to shoot this phase"
    if ctype == "eligible-to-shoot":
        return f"{negate}the unit is eligible to shoot"
    if ctype == "selection-has-keyword":
        selection = p.get("selection")
        selected = "the selected unit"
        if isinstance(selection, dict):
            if "observer_for" in selection:
                reference = selection.get("observer_for")
                if isinstance(reference, dict) and "selection_var" in reference:
                    selected = (
                        "the Observer unit that marked the bound "
                        + _str(reference.get("selection_var")).replace("_", " ")
                    )
            elif "selection_var" in selection:
                selected = (
                    "the bound "
                    + _str(selection.get("selection_var")).replace("_", " ")
                )
        return f"{negate}{selected} has the {_str(p.get('keyword'))} keyword"
    if ctype == "is-battle-shocked":
        return f"{negate}the unit is battle-shocked"
    if ctype == "has-lost-wounds":
        return f"{negate}the model has lost wounds"
    if ctype == "wounds-remaining-at-or-below":
        threshold = p.get("threshold")
        threshold = threshold if threshold is not None else 0
        return f"{negate}the model has {_str(threshold)} or fewer wounds remaining"
    if ctype == "was-hit-by-attack":
        subject = (
            "the target"
            if p.get("subject") == "target"
            else "the selected friendly unit"
            if p.get("subject") == "selected-friendly-unit"
            else "the unit"
        )
        atk = f"{_str(p.get('attack_type'))} " if p.get("attack_type") else ""
        keyword = (
            f"[{dekebab(_str(p.get('weapon_keyword'))).upper()}]"
            if p.get("weapon_keyword")
            else ""
        )
        weapon = (
            f" by {_str(p.get('weapon_name'))}{f' (with {keyword})' if keyword else ''}"
            if p.get("weapon_name")
            else f" made with a {keyword} weapon"
            if keyword
            else ""
        )
        source = p.get("source")
        window = (
            " during its just-finished shooting sequence"
            if p.get("window") == "just-finished-shooting-sequence"
            else " this phase"
        )
        n = int(p.get("count_min") or 1)
        if n > 1:
            return f"{negate}{subject} was hit by {n}+ {atk}attacks{weapon}{bound_source}{window}"
        attack = "an attack" if not atk else f"a {atk}attack"
        return f"{negate}{subject} was hit by {attack}{weapon}{bound_source}{window}"
    if ctype == "wounds-lost-from-attack":
        subject = "the target" if p.get("subject") == "target" else "the unit"
        attack_type = f"{_str(p.get('attack_type'))} " if p.get("attack_type") else ""
        source = " from the triggering attacks" if p.get("source") == "triggering-attacks" else ""
        return f"{negate}{subject} lost one or more wounds from {attack_type}attacks{source}"
    if ctype == "opponent-unit-within-range":
        if p.get("weapon_name") is not None:
            within = f"range of {dekebab(_str(p.get('weapon_name')))}"
        elif p.get("range_multiplier") is not None:
            within = "half range of its ranged weapons"
        else:
            range_ = p.get("range")
            if range_ is None:
                range_ = p.get("range_inches")
            if range_ is None:
                range_ = p.get("within_inches")
            within = "engagement range" if range_ == "engagement" else f'{_str(range_)}"'
        return f"{negate}an enemy unit is within {within}"
    if ctype == "unit-within-range-of":
        if isinstance(p.get("keywords"), list):
            who = (
                "this model"
                if p.get("subject") == "self"
                else "the triggering unit"
                if p.get("subject") == "triggering-unit"
                else "the unit"
            )
            distance = (
                "Engagement Range" if p.get("range") == "engagement" else f'{_str(p.get("range"))}"'
            )
            owner = "friendly" if p.get("target_type") == "friendly-keyword" else "enemy"
            keyword_text = " and ".join(_str(k) for k in p["keywords"])
            return (
                f"{negate}{who} is within {distance} of one or more {owner} units "
                f"with all of {keyword_text}"
            )
        tt = _str(p.get("target_type") if p.get("target_type") is not None else "target")
        # Targets that name a specific model, not a radius — no inches apply.
        if tt == "closest-eligible":
            within = f' within {_str(p.get("range"))}"' if p.get("range") is not None else ""
            return f"{negate}the target is the closest eligible target{within}"
        if tt == "area-terrain":
            return f"{negate}within an area terrain feature"
        if tt == "friendly-keyword" and p.get("keyword"):
            who = f"a friendly {_str(p.get('keyword'))} unit"
        elif tt == "friendly":
            who = "a friendly unit"
        else:
            who = dekebab(tt)
        # A missing range stays as ?" so the audit still flags it as a data gap.
        dist = f'{_str(p.get("range"))}"' if p.get("range") is not None else '?"'
        return f"{negate}within {dist} of {who}"
    if ctype == "within-range-of-objective":
        if p.get("subject") is None and p.get("controlled_by") is None:
            return f"{negate}within range of an objective"
        who = (
            "the target unit"
            if p.get("subject") == "target"
            else "the attacking unit"
            if p.get("subject") == "attacker"
            else "the unit"
        )
        control = (
            " you control"
            if p.get("controlled_by") == "your-army"
            else " your opponent controls"
            if p.get("controlled_by") == "opponent"
            else ""
        )
        return f"{negate}{who} is within range of an objective marker{control}"
    if ctype == "event-source-is-bearer-unit":
        return f"{negate}the triggering event was performed by this unit"
    if ctype == "event-source-is-attached-unit":
        return f"{negate}the triggering Act of Faith was performed by the unit this model leads"
    if ctype == "miracle-die-generation-reason":
        keywords = " ".join(_str(k) for k in p.get("keywords") or []) if isinstance(p.get("keywords"), list) else ""
        return f"{negate}the Miracle die was gained because a friendly {keywords} unit or model was destroyed"
    if ctype == "miracle-die-generation-timing":
        return f"{negate}the Miracle die was gained at the start of the battle round"
    if ctype == "destroyed-event-within-range":
        return f'{negate}that destroyed unit or model was within {_str(p.get("range"))}" of this model'
    if ctype == "destroyed-by-friendly-unit":
        keywords = " ".join(_str(k) for k in p.get("keywords") or []) if isinstance(p.get("keywords"), list) else ""
        return f"{negate}the unit was destroyed by a friendly {keywords} unit"
    if ctype == "target-is-visible":
        return f"{negate}the target is visible to the attacking model"
    if ctype == "has-fought-this-phase":
        who = (
            "this model "
            if p.get("subject") == "self"
            else "the destroyed model "
            if p.get("subject") == "destroyed-model"
            else "the unit "
            if p.get("subject") == "unit"
            else "the target unit "
            if p.get("subject") == "target"
            else ""
        )
        return f"{negate}{who}has fought this phase"
    if ctype == "destroyed-by-attack-type":
        if p.get("attack_type") == "any":
            return f"{negate}destroyed by any attack"
        return f"{negate}destroyed by a {_str(p.get('attack_type'))} attack"
    if ctype == "attack-stat-compare":
        # Mirrors the Rust arm byte-for-byte: missing params render as "" (not "?").
        def _sv(v: Any) -> str:
            return "" if v is None else _str(v)

        return (
            f"{negate}the attack's {_sv(p.get('attacker_stat'))} is "
            f"{dekebab(_sv(p.get('comparison')))} the target's {_sv(p.get('target_stat'))}"
        )
    if ctype == "made-ingress-move-this-turn":
        return f"{negate}the unit made an ingress move (including a Deep Strike setup) this turn"
    if ctype == "engagement-state":
        state = p.get("state")
        if state is None:
            return f"{negate}the unit is within Engagement Range"
        st = _str(state)
        if st == "on-battlefield":
            return f"{negate}the unit is on the battlefield"
        if st == "embarked":
            return f"{negate}the unit is embarked"
        if st in ("engaged", "within-engagement-range", "in-engagement-range"):
            return f"{negate}the unit is within Engagement Range"
        return f"{negate}the unit is {dekebab(st)}"
    if ctype == "unit-was-in-engagement-range-of":
        snapshot_point = "the turn" if p.get("snapshot") == "turn-start" else "the phase"
        return f"{negate}the selected friendly unit started {snapshot_point} within Engagement Range of that enemy unit"
    if ctype == "ability-window-capacity":
        source = (p.get("source_ability") or {}).get("ability_id")
        return f"{negate}the {dekebab(_str(source))} ability had unused selection capacity at the end of the opponent's previous turn"
    if ctype == "candidate-eligible-in-ability-window":
        source = (p.get("source_ability") or {}).get("ability_id")
        return f"{negate}the candidate was eligible for the {dekebab(_str(source))} ability at the end of the opponent's previous turn"
    if ctype == "disposition-matches":
        d = _str(p.get("disposition"))
        if d == "strategic-reserves":
            return f"{negate}the unit is in Strategic Reserves"
        return f"{negate}the unit's disposition is {dekebab(d)}"
    if ctype == "fights-first":
        return f"{negate}the unit has Fights First"

    # ── Scoring conditions (secondary-card award `when`) ─────────────────────
    if ctype == "objective-majority":
        rel = p.get("relative_to")
        rel = rel if rel is not None else "opponent"
        return f"{negate}you hold more objectives than the {dekebab(_str(rel))}"
    if ctype == "controls-objective":
        role = p.get("objective_role")
        noun = f"{dekebab(_str(role))} objective" if role else "objective"
        count_min = p.get("count_min")
        s = f"{negate}you control {_count(count_min if count_min is not None else 1, noun)}"
        if p.get("objective") is not None:
            s += f" ({dekebab(_str(p['objective']))})"
        if p.get("scope") is not None:
            s += f" in {dekebab(_str(p['scope']))}"
        if p.get("exclude") is not None:
            s += f" (excluding {dekebab(_str(p['exclude']))})"
        return s
    if ctype == "units-destroyed":
        count_min = p.get("count_min")
        n = count_min if count_min is not None else 1
        side_unit = f"{_str(p.get('side'))} unit"
        s = f"{negate}{_count(n, side_unit)} destroyed"
        if p.get("window") is not None:
            s += f" {dekebab(_str(p.get('window')))}"
        return s
    if ctype == "units-destroyed-comparison":
        subj = p.get("subject") or {}
        ref = p.get("reference") or {}
        gte = p.get("comparator") == "greater-or-equal"
        cmp_ = "at least as many" if gte else "more"
        link = "as" if gte else "than"
        return (
            f"{negate}you destroyed {cmp_} {_str(subj.get('side'))} units "
            f"{dekebab(_str(subj.get('window')))} {link} {_str(ref.get('side'))} units "
            f"{dekebab(_str(ref.get('window')))}"
        )
    if ctype == "new-objective-controlled":
        count_min = p.get("count_min")
        n = count_min if count_min is not None else 1
        return f"{negate}you newly control {_count(n, 'objective')} this turn"
    if ctype == "destroyed-while-on-objective":
        role = p.get("objective_role")
        obj = f"a {dekebab(_str(role))} objective" if role else "an objective"
        count_min = p.get("count_min")
        s = f"{negate}{_count(count_min if count_min is not None else 1, 'enemy unit')} destroyed"
        if p.get("destroyer_on_objective"):
            s += f" by a unit on {obj}"
        if p.get("victim_on_objective"):
            s += f" while on {obj}"
        if p.get("victim_started_turn_on_objective"):
            s += f" that started the turn on {obj}"
        return s
    if ctype == "destroyed-in-tagged-terrain":
        where = "that started the turn in" if p.get("at_start_of_turn") else "while in"
        tag = p.get("tag")
        terrain = f"{dekebab(_str(tag))} terrain" if tag is not None else "a terrain area"
        count_min = p.get("count_min")
        n = count_min if count_min is not None else 1
        return f"{negate}{_count(n, 'enemy unit')} destroyed {where} {terrain}"
    if ctype == "operation-markers":
        side = f"{_str(p['side'])} " if p.get("side") is not None else ""
        min_ = p.get("count_min") if isinstance(p.get("count_min"), (int, float)) else None
        max_ = p.get("count_max") if isinstance(p.get("count_max"), (int, float)) else None
        if max_ == 0:
            s = f"no {side}operation markers on the battlefield"
        elif min_ is not None and max_ is not None and min_ == max_:
            plural = "" if min_ == 1 else "s"
            s = f"exactly {_str(min_)} {side}operation marker{plural} on the battlefield"
        else:
            n_text = _str(min_ if min_ is not None else 1)
            s = f"{n_text}+ {side}operation markers on the battlefield"
        if p.get("within_range_of") is not None:
            s += f" within range of {dekebab(_str(p['within_range_of']))}"
        if p.get("friendly_unit_in_same_terrain_area"):
            s += " with a friendly unit in the same terrain area"
        if p.get("no_enemy_in_terrain_area"):
            s += " and no enemy units in that terrain area"
        return f"{negate}{s}"
    if ctype == "action-completed":
        count_min = p.get("count_min")
        s = f"{negate}{_count(count_min if count_min is not None else 1, 'action')} completed"
        if p.get("action_id") is not None:
            s += f" ({dekebab(_str(p['action_id']))})"
        if p.get("target_kind") is not None:
            s += f" on {dekebab(_str(p['target_kind']))}"
        tf = p.get("target_filter") or {}
        if tf.get("objective_role") is not None:
            s += f" ({dekebab(_str(tf['objective_role']))})"
        if tf.get("in_enemy_territory"):
            s += " in enemy territory"
        if tf.get("exclude") is not None:
            s += f" (excluding {dekebab(_str(tf['exclude']))})"
        if p.get("window") is not None:
            s += f" {dekebab(_str(p['window']))}"
        return s
    if ctype == "objective-has-tag":
        count_min = p.get("count_min")
        n = count_min if count_min is not None else 1
        s = f"{negate}{_count(n, 'objective')} tagged {dekebab(_str(p.get('tag')))}"
        if p.get("count_max") is not None:
            s += f" (at most {_str(p['count_max'])})"
        if p.get("objective") is not None:
            s += f" ({dekebab(_str(p['objective']))})"
        if p.get("scope") is not None:
            s += f" in {dekebab(_str(p['scope']))}"
        if p.get("last_marked"):
            s += " (most recently marked)"
        return s
    if ctype == "unit-has-tag":
        # Ability-gate use (no side/count) reads as a unit state; scoring counts tagged units.
        if p.get("side") is None and p.get("count_min") is None:
            return f"{negate}the unit is tagged {dekebab(_str(p.get('tag')))}"
        count_min = p.get("count_min")
        n = count_min if count_min is not None else 1
        side_unit = f"{_str(p.get('side'))} unit"
        s = f"{negate}{_count(n, side_unit)} tagged {dekebab(_str(p.get('tag')))}"
        if p.get("window") is not None:
            s += f" ({dekebab(_str(p['window']))})"
        return s
    if ctype == "terrain-has-tag":
        s = f"{negate}terrain tagged {dekebab(_str(p.get('tag')))}"
        if p.get("friendly_units_min") is not None:
            s += f" with {_str(p['friendly_units_min'])}+ friendly units"
        if p.get("enemy_units_max") is not None:
            s += f" and at most {_str(p['enemy_units_max'])} enemy units"
        if p.get("last_marked"):
            s += " (most recently marked)"
        if p.get("in_enemy_dz"):
            s += " in the enemy deployment zone"
        return s
    if ctype == "region-membership":
        return _region_membership_phrase(p, bool(c.get("negated")))
    if ctype == "terrain-area-control":
        min_models = p.get("min_models")
        n = min_models if min_models is not None else 1
        return f"{negate}you control a terrain area with {_str(n)}+ models"
    if ctype == "territory-control":
        ref = p.get("territory_ref")
        ref = ref if ref is not None else "your-territory"
        s = f"{negate}you control {dekebab(_str(ref))}"
        if p.get("enemy_units_max") is not None:
            s += f" with at most {_str(p['enemy_units_max'])} enemy units"
        return s
    if ctype == "engagement-fronts":
        count_min = p.get("count_min")
        n = count_min if count_min is not None else 1
        return f"{negate}you are engaged on {_str(n)}+ fronts"
    if ctype == "token-count-at-or-above":
        return f"{negate}the unit has {_str(p.get('threshold'))}+ {dekebab(_str(p.get('pool_id')))}"
    if ctype == "battle-round":
        b_min = _round_number(p.get("min")) if p.get("min") is not None else None
        b_max = _round_number(p.get("max")) if p.get("max") is not None else None
        if b_min is not None and b_max is not None:
            where = (
                f"the {_battle_round_ord(b_min)} battle round"
                if b_min == b_max
                else f"battle rounds {_str(b_min)}-{_str(b_max)}"
            )
        elif b_min is not None:
            where = f"the {_battle_round_ord(b_min)} battle round onward"
        elif b_max is not None:
            where = f"the first {_str(b_max)} battle rounds"
        else:
            where = "the battle round"
        return f"{negate}during {where}"

    return f"{negate}{dekebab(ctype if ctype is not None else 'unknown')}"
