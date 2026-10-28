"""Lead-in clauses for conditions ("while the unit is Battle-shocked", "against MONSTER
targets") and selection-eligibility clauses on an already-named candidate unit ("that is
not Battle-shocked"). Python mirror of ``tools/src/translate/condition-leadin.ts``.
"""

from __future__ import annotations

import re
from collections.abc import Callable

from wh40kdc.translate.condition import Condition, _describe_predicate, describe_condition
from wh40kdc.translate.condition_history import _describe_happened
from wh40kdc.translate.condition_refs import (
    P,
    _and_list,
    _article,
    _cap_word,
    _list,
    _obj,
    _or_list,
    _str,
    _truthy,
    _window_phrase,
    title_case,
)


def describe_selection_eligibility(c: Condition) -> str:
    """Render a condition as a predicate on an already-named candidate unit, so selection
    eligibility reads distinct from an ability's own condition ("that is not Battle-shocked")."""
    operands = c.get("operands")
    inner = (
        operands[0]
        if c.get("operator") == "not" and isinstance(operands, list) and len(operands) == 1
        else c
    )
    if (
        inner.get("type") == "matches"
        and _obj(inner.get("parameters")).get("filter") == {"state": "battle-shocked"}
        and _obj(inner.get("parameters")).get("subject") is None
    ):
        return "that is Battle-shocked" if inner is c else "that is not Battle-shocked"
    if c.get("operator") == "and" and operands is not None:

        def flat(n: Condition) -> list[Condition]:
            if n.get("operator") == "and" and n.get("operands") is not None:
                return [x for o in n["operands"] for x in flat(o)]
            return [n]

        parts = [_candidate_clause(o) for o in flat(c)]
        if all(part is not None for part in parts):
            return " and ".join(part for part in parts if part is not None)
    if c.get("operator") == "or" and operands is not None:
        alts = [_candidate_clause(o) for o in operands]
        if all(part is not None for part in alts):
            return " or ".join(part for part in alts if part is not None)
    clause = _candidate_clause(c)
    return clause if clause is not None else f"if {describe_condition(c)}"


_CANDIDATE_PREFIXES = (
    ("the unit is not the same unit as ", "other than "),
    ("the unit does not have ", "without "),
    ("the unit has not ", "that has not "),
    ("the unit has ", "with "),
    ("not the unit is ", "that is not "),
    ("the unit ", "that "),
)


def _candidate_clause(c: Condition) -> str | None:
    """A condition on the candidate as a relative clause ("that was hit...", "without ..")."""
    phrase = describe_condition(c)
    for frm, to in _CANDIDATE_PREFIXES:
        if phrase.startswith(frm):
            return f"{to}{phrase[len(frm) :]}"
    return None


# -- Lead-ins -----------------------------------------------------------------


def _negated_target_keywords(keywords: list[str]) -> str:
    """ "against a unit that is not a X or Y": the attack's target lacks every listed keyword."""
    return f"against a unit that is not a {' or '.join(keywords)}"


def _keyword_names(p: P) -> str:
    if isinstance(p.get("any_of"), list):
        return _or_list([_str(k) for k in p["any_of"]])
    return _and_list([_str(k) for k in _list(p.get("all_of"))])



def _matches_lead_in(c: Condition, negated: bool) -> str:
    p = _obj(c.get("parameters"))
    f = _obj(p.get("filter"))
    keys = [key for key in f if key != "level"]
    if len(keys) == 1 and (f.get("all_of") is not None or f.get("any_of") is not None):
        if p.get("subject") == "defender":
            if negated and isinstance(f.get("all_of"), list) and len(f["all_of"]) > 1:
                keywords = _and_list([_str(k) for k in f["all_of"]])
                return f"against a unit that does not have all of {keywords}"
            words = _keyword_names(f)
            if negated:
                return f"against a unit that is not a {words}"
            return f"against {words} targets"
        if p.get("subject") is None or (negated and p.get("subject") == "recipient"):
            words = _keyword_names(f)
            plural = isinstance(f.get("any_of"), list) or len(_list(f.get("all_of"))) > 1
            lead = "unless" if negated else "if"
            suffix = "s" if plural and not negated else ""
            return f"{lead} the unit has the {words} keyword{suffix}"
        return f"{'unless' if negated else 'if'} {_describe_predicate(c, False)}"
    if (
        len(keys) == 1
        and f.get("designated") is not None
        and p.get("subject") == "defender"
        and _str(f["designated"]) == _str(f["designated"]).upper()
        and not negated
    ):
        return f"against {_str(f['designated'])} targets"
    return f"while {_describe_predicate(c, negated)}"

# Leaves that protect the unit being attacked: an attack condition on them is the incoming attack.
_DEFENSIVE_LEAVES = frozenset({"invulnerable-save", "feel-no-pain", "damage-reduction"})
_DEFENSIVE_STATS = frozenset({"Sv", "T"})


def is_defensive_effect(e: object) -> bool:
    """Whether an effect protects the unit being attacked (a save, Feel No Pain, damage
    reduction, its Save or Toughness)."""
    if not isinstance(e, dict):
        return False
    if e.get("type") in _DEFENSIVE_LEAVES:
        return True
    modifier = e.get("modifier")
    stat = modifier.get("stat") if isinstance(modifier, dict) else None
    return e.get("type") == "stat-modifier" and stat in _DEFENSIVE_STATS


def condition_lead_in(c: Condition, defending: bool = False) -> str:
    """A condition as a natural lead-in clause (lowercase-initial; the caller capitalizes at
    the sentence boundary). Falls back to ``if <condition>`` for shapes without a dedicated
    framing. ``defending`` frames attack conditions from the attacked unit's side ("against
    ranged attacks"), for a condition gating a defensive effect."""
    op = c.get("operator")
    operands = c.get("operands")
    if op == "and" and operands is not None:
        return _join_lead_ins(operands, defending)
    if op == "or" and operands is not None:
        return " or ".join(condition_lead_in(o, defending) for o in operands)
    if op == "not" and operands is not None:
        if (
            len(operands) == 1
            and isinstance(operands[0], dict)
            and not _truthy(operands[0].get("operator"))
        ):
            return _negated_lead_in(operands[0], defending)
        return "unless " + " or ".join(
            re.sub(r"^if ", "", condition_lead_in(o, defending), count=1) for o in operands
        )
    p = _obj(c.get("parameters"))
    ctype = c.get("type")
    if ctype == "phase-is":
        phase = _str(p.get("phase"))
        return (
            "during the Command phase"
            if phase == "command"
            else f"during the {title_case(phase)} phase"
        )
    if ctype in ("player-turn-is", "battle-round"):
        return re.sub(
            r"^during the (\w+) battle round onward$",
            r"from the \1 battle round onward",
            _describe_predicate(c, False),
            flags=re.ASCII,
        )
    if ctype == "rule-active":
        return f"while {_describe_predicate(c, False)}"
    if ctype == "matches":
        return _matches_lead_in(c, False)
    if ctype == "has-keyword":
        if p.get("chosen_by") is not None:
            return f"if {_describe_predicate(c, False)}"
        if p.get("subject") == "defender":
            return f"against {_keyword_names(p)} targets"
        if p.get("subject") is None:
            plural = isinstance(p.get("any_of"), list) or len(_list(p.get("all_of"))) > 1
            return f"if the unit has the {_keyword_names(p)} keyword{'s' if plural else ''}"
        return f"if {_describe_predicate(c, False)}"
    if ctype == "attachment":
        if p.get("role") == "leading" and (
            p.get("subject") == "this-model" or p.get("subject") is None
        ):
            w = _obj(p.get("with"))
            kw = (
                f"{' '.join(_str(k) for k in w['all_of'])} "
                if isinstance(w.get("all_of"), list)
                else ""
            )
            return f"while this model is leading a {kw}unit"
        return f"while {_describe_predicate(c, False)}"
    if ctype == "happened":
        f = _obj(p.get("filter"))
        types = _list(f.get("move_types"))
        if (
            p.get("event") == "move-ended"
            and p.get("window") == "turn"
            and len(types) == 1
            and p.get("subject") is None
        ):
            if types[0] == "charge":
                return "if the unit charged this turn"
            if types[0] == "advance":
                return "if the unit Advanced this turn"
            if types[0] == "remain-stationary":
                return "if the unit Remained Stationary this turn"
        if (
            p.get("event") == "disembarked"
            and p.get("subject") is None
            and f.get("transport") is None
        ):
            window = _window_phrase(p.get("window"))
            return f"if the unit disembarked from a Transport {window}".rstrip()
        # "while the unit is performing an Agile Manoeuvre": the use is being resolved now.
        if (
            p.get("event") == "used"
            and p.get("window") == "event"
            and f.get("ability_keyword") is None
            and f.get("same_rule_as") is None
        ):
            return f"while {_describe_happened(p, False)}"
        if (
            p.get("event") in ("destroyed", "model-destroyed")
            and p.get("object") == "event-object"
            and p.get("window") == "event"
        ):
            return f"when {_describe_happened(p, False)}"
        return f"if {_describe_happened(p, False)}"
    if ctype == "resource":
        word = "if" if p.get("below_max") is True else "while"
        return f"{word} {_describe_predicate(c, False)}"
    if ctype == "strength":
        phrase = re.sub(
            r" is below starting strength$",
            " is below its starting strength",
            _describe_predicate(c, False),
            count=1,
        )
        return f"while {phrase}"
    if ctype == "designated":
        tag = _str(p.get("tag"))
        if p.get("subject") == "defender" and tag == tag.upper():
            return f"against {tag} targets"
        return f"while {_describe_predicate(c, False)}"
    if ctype in ("unit-state", "wounds", "owned-by", "within", "in-region"):
        return f"while {_describe_predicate(c, False)}"
    if ctype == "attack-is":
        if p.get("all_target_same_unit") is True:
            return f"when {_describe_predicate(c, False)}"
        lead = "against " if defending else "while making "
        return re.sub(r"^for ", lead, _describe_predicate(c, False), count=1)
    if ctype == "attack-compare":
        return f"when {_describe_predicate(c, False)}"
    return f"if {_describe_predicate(c, False)}"


def _negated_lead_in(c: Condition, defending: bool) -> str:
    ctype = c.get("type")
    if ctype == "same-unit":
        return f"if {_describe_predicate(c, True)}"
    if ctype == "matches":
        return _matches_lead_in(c, True)
    if ctype in ("unit-state", "designated"):
        return f"while {_describe_predicate(c, True)}"

    # Otherwise the positive lead-in, turned: "unless an enemy unit is within 12\"".
    def turn(m: re.Match[str]) -> str:
        return m.group(0) if m.group(1) in ("during", "in", "against") else ""

    return "unless " + re.sub(
        r"^(if|while|when|during|in|against) ", turn, condition_lead_in(c, defending), count=1
    )


def _not_keyword(op: Condition, subject: str) -> str | None:
    """The keyword of ``not(matches <subject> X)`` with a single keyword, else None."""
    operands = op.get("operands")
    if op.get("operator") != "not" or not isinstance(operands, list) or len(operands) != 1:
        return None
    inner = operands[0]
    p = _obj(inner.get("parameters"))
    f = _obj(p.get("filter"))
    all_of = f.get("all_of")
    if (
        inner.get("type") != "matches"
        or p.get("subject") != subject
        or set(f) != {"all_of"}
        or not isinstance(all_of, list)
        or len(all_of) != 1
    ):
        return None
    return _str(all_of[0])


def _own_keyword(op: Condition) -> str | None:
    """A bare single-keyword ``matches`` on the ability's own unit, else None."""
    p = _obj(op.get("parameters"))
    f = _obj(p.get("filter"))
    all_of = f.get("all_of")
    if (
        op.get("type") != "matches"
        or p.get("subject") is not None
        or set(f) != {"all_of"}
        or not isinstance(all_of, list)
        or len(all_of) != 1
    ):
        return None
    return _str(all_of[0])


def _join_lead_ins(operands: list[Condition], defending: bool) -> str:
    """Join the operands of an ``and`` lead-in. Runs of keyword exclusions collapse into one
    clause: on the attack's target, "against a unit that is not a X or Y"; on the unit an aura
    or effect is applied to, "(excluding X or Y units)". Either attaches to the preceding
    clause with a space; a run of the unit's own keywords reads "if the unit is a X Y unit";
    all other operands join with ", "."""
    parts: list[str] = []

    def run(i: int, pick: Callable[[Condition], str | None]) -> tuple[list[str], int]:
        kws: list[str] = []
        while i < len(operands):
            kw = pick(operands[i])
            if kw is None:
                break
            kws.append(kw)
            i += 1
        return kws, i

    i = 0
    while i < len(operands):
        op = operands[i]
        if _not_keyword(op, "defender") is not None:
            kws, i = run(i, lambda o: _not_keyword(o, "defender"))
            parts.append(_negated_target_keywords(kws))
            continue
        if _not_keyword(op, "recipient") is not None:
            kws, i = run(i, lambda o: _not_keyword(o, "recipient"))
            parts.append(f"(excluding {' or '.join(_cap_word(k) for k in kws)} units)")
            continue
        if _own_keyword(op) is not None:
            kws, i = run(i, _own_keyword)
            parts.append(
                f"if the unit is {_article(kws[0])} {' '.join(kws)} unit"
                if len(kws) >= 2
                else f"if the unit has the {kws[0]} keyword"
            )
            continue
        parts.append(condition_lead_in(op, defending))
        i += 1
    acc = ""
    for part in parts:
        # A second keyword gate on the same target narrows it:
        # "against ORKS targets that are also VEHICLE".
        target = re.match(r"^against (.+) targets$", part)
        if acc == "":
            acc = part
        elif target and acc.endswith(" targets") and re.search(r"(^|, )against ", acc):
            acc = f"{acc} that are also {target.group(1)}"
        elif (
            part.startswith("against ") and not re.match(r"^against [a-z -]*attacks( |$)", part)
        ) or part.startswith("(excluding "):
            # A target narrowing attaches to the clause before it;
            # an incoming attack is its own clause.
            acc = f"{acc} {part}"
        else:
            acc = f"{acc}, {part}"
    return acc
