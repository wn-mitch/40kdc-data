/**
 * Conditions as sentence lead-ins ("while the unit is Battle-shocked", "against MONSTER
 * targets") and as relative clauses on a selection's candidate ("that was hit…").
 */
import { describeCondition, describePredicate, type Condition } from "./condition.js";
import { describeHappened } from "./condition-history.js";
import { andList, idLabel, orList, type P, str, titleCase, windowPhrase } from "./condition-refs.js";

/**
 * Render a condition as a predicate on an already-named candidate unit, so selection
 * eligibility reads distinct from an ability's own condition ("that is not Battle-shocked").
 */
export function describeSelectionEligibility(c: Condition): string {
  const inner = c.operator === "not" && c.operands?.length === 1 ? c.operands[0]! : c;
  if (inner.type === "unit-state" && inner.parameters?.state === "battle-shocked" && inner.parameters?.subject == null)
    return inner === c ? "that is Battle-shocked" : "that is not Battle-shocked";
  if (c.operator === "and" && c.operands) {
    const flat = (n: Condition): Condition[] => (n.operator === "and" && n.operands ? n.operands.flatMap(flat) : [n]);
    const parts = flat(c).map(candidateClause);
    if (parts.every((part): part is string => part !== null)) return parts.join(" and ");
  }
  if (c.operator === "or" && c.operands) {
    const parts = c.operands.map(candidateClause);
    if (parts.every((part): part is string => part !== null)) return parts.join(" or ");
  }
  return candidateClause(c) ?? `if ${describeCondition(c)}`;
}

/** A condition on the candidate as a relative clause ("that was hit…", "without \"MONSTER\""), else null. */
function candidateClause(c: Condition): string | null {
  const phrase = describeCondition(c);
  for (const [from, to] of [["the unit is not the same unit as ", "other than "], ["the unit does not have ", "without "], ["the unit has not ", "that has not "], ["the unit has ", "with "], ["not the unit is ", "that is not "], ["the unit ", "that "]] as const) {
    if (phrase.startsWith(from)) return `${to}${phrase.slice(from.length)}`;
  }
  return null;
}

// ── Lead-ins ────────────────────────────────────────────────────────────────

/** "against a unit that is not a X or Y": the attack's target lacks every listed keyword. */
function negatedTargetKeywords(keywords: string[]): string {
  return `against a unit that is not a ${keywords.join(" or ")}`;
}

/** Capitalize the first character and lowercase the rest (`MONSTER` -> `Monster`). */
function capWord(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1).toLowerCase();
}

function keywordNames(p: P): string {
  return Array.isArray(p.any_of) ? orList((p.any_of as unknown[]).map(str)) : andList(((p.all_of as unknown[]) ?? []).map(str));
}

/**
 * A condition as a natural lead-in clause (lowercase-initial; the caller capitalizes at the
 * sentence boundary). Falls back to `if <condition>` for shapes without a dedicated framing.
 */
export function conditionLeadIn(c: Condition): string {
  if (c.operator === "and" && c.operands) return joinLeadIns(c.operands);
  if (c.operator === "or" && c.operands) return c.operands.map(conditionLeadIn).join(" or ");
  if (c.operator === "not" && c.operands) {
    const only = c.operands[0];
    if (c.operands.length === 1 && only && !only.operator) return negatedLeadIn(only);
    return `unless ${c.operands.map((o) => conditionLeadIn(o).replace(/^if /, "")).join(" or ")}`;
  }
  const p = c.parameters ?? {};
  switch (c.type) {
    case "phase-is":
      return str(p.phase) === "command" ? "during the Command phase" : `during the ${titleCase(str(p.phase))} phase`;
    case "player-turn-is":
    case "battle-round":
      return describePredicate(c, false).replace(/^during the (\w+) battle round onward$/, "from the $1 battle round onward");
    case "rule-active":
      return `while the ${idLabel(p.rule)} is active`;
    case "has-keyword":
      if (p.chosen_by != null) return `if ${describePredicate(c, false)}`;
      if (p.subject === "defender") return `against ${keywordNames(p)} targets`;
      if (p.subject == null) return `if the unit has the ${keywordNames(p)} keyword${Array.isArray(p.any_of) || ((p.all_of as unknown[]) ?? []).length > 1 ? "s" : ""}`;
      return `if ${describePredicate(c, false)}`;
    case "attachment":
      if (p.role === "leading" && (p.subject === "this-model" || p.subject == null)) {
        const w = (p.with ?? {}) as P;
        return `while this model is leading a ${Array.isArray(w.all_of) ? `${(w.all_of as unknown[]).map(str).join(" ")} ` : ""}unit`;
      }
      return `while ${describePredicate(c, false)}`;
    case "happened": {
      const f = (p.filter ?? {}) as P;
      const types = (f.move_types as string[] | undefined) ?? [];
      if (p.event === "move-ended" && p.window === "turn" && types.length === 1 && p.subject == null) {
        if (types[0] === "charge") return "if the unit charged this turn";
        if (types[0] === "advance") return "if the unit Advanced this turn";
        if (types[0] === "remain-stationary") return "if the unit Remained Stationary this turn";
      }
      if (p.event === "disembarked" && p.subject == null) return `if the unit disembarked from a Transport ${windowPhrase(p.window)}`.trimEnd();
      if ((p.event === "destroyed" || p.event === "model-destroyed") && p.object === "event-object" && p.window === "event")
        return `when ${describeHappened(p, false)}`;
      return `if ${describeHappened(p, false)}`;
    }
    case "resource":
      return p.below_max === true ? `if ${describePredicate(c, false)}` : `while ${describePredicate(c, false)}`;
    case "strength":
      return `while ${describePredicate(c, false).replace(/ is below starting strength$/, " is below its starting strength")}`;
    case "designated":
      if (p.subject === "defender" && str(p.tag) === str(p.tag).toUpperCase()) return `against ${str(p.tag)} targets`;
      return `while ${describePredicate(c, false)}`;
    case "unit-state":
    case "wounds":
    case "owned-by":
      return `while ${describePredicate(c, false)}`;
    case "attack-is":
      if (p.all_target_same_unit === true) return `when ${describePredicate(c, false)}`;
      return describePredicate(c, false).replace(/^for /, "while making ");
    case "attack-compare":
      return `when ${describePredicate(c, false)}`;
    case "model-count":
    case "loadout":
      return `if ${describePredicate(c, false)}`;
    case "within":
    case "in-region":
      return `while ${describePredicate(c, false)}`;
    default:
      return `if ${describePredicate(c, false)}`;
  }
}

function negatedLeadIn(c: Condition): string {
  const p = c.parameters ?? {};
  if (c.type === "same-unit") return `if ${describePredicate(c, true)}`;
  if (c.type === "has-keyword" && p.chosen_by == null && p.subject === "defender")
    return negatedTargetKeywords(Array.isArray(p.any_of) ? (p.any_of as unknown[]).map(str) : ((p.all_of as unknown[]) ?? []).map(str));
  if (c.type === "has-keyword" && p.chosen_by == null && (p.subject == null || p.subject === "recipient")) return `unless the unit has the ${keywordNames(p)} keyword`;
  if (c.type === "unit-state" || c.type === "designated" || c.type === "owned-by") return `while ${describePredicate(c, true)}`;
  // Otherwise the positive lead-in, turned: "unless an enemy unit is within 12\"".
  return `unless ${conditionLeadIn(c).replace(/^(if|while|when|during|in|against) /, (m, w: string) => (w === "during" || w === "in" || w === "against" ? m : ""))}`;
}

/** The keyword of `not(has-keyword <subject> X)` with a single keyword, else null. */
function notKeyword(op: Condition, subject: string): string | null {
  if (op.operator !== "not" || op.operands?.length !== 1) return null;
  const inner = op.operands[0]!;
  const p = inner.parameters ?? {};
  if (inner.type !== "has-keyword" || p.subject !== subject || !Array.isArray(p.all_of) || p.all_of.length !== 1) return null;
  return str(p.all_of[0]);
}

/** A bare single-keyword `has-keyword` on the ability's own unit, else null. */
function ownKeyword(op: Condition): string | null {
  const p = op.parameters ?? {};
  if (op.type !== "has-keyword" || p.subject != null || !Array.isArray(p.all_of) || p.all_of.length !== 1) return null;
  return str(p.all_of[0]);
}

/**
 * Join the operands of an `and` lead-in. Runs of keyword exclusions collapse into one clause:
 * on the attack's target, "against a unit that is not a X or Y"; on the unit an aura or effect
 * is applied to, "(excluding X or Y units)". Either attaches to the preceding clause with a
 * space; a run of the unit's own keywords reads "if the unit is a X Y unit"; all other operands
 * join with ", ".
 */
function joinLeadIns(operands: Condition[]): string {
  const parts: string[] = [];
  const run = (i: number, pick: (op: Condition) => string | null): [string[], number] => {
    const kws: string[] = [];
    let kw: string | null;
    while (i < operands.length && (kw = pick(operands[i]!)) != null) {
      kws.push(kw);
      i++;
    }
    return [kws, i];
  };
  for (let i = 0; i < operands.length; ) {
    const op = operands[i]!;
    if (notKeyword(op, "defender") != null) {
      const [kws, next] = run(i, (o) => notKeyword(o, "defender"));
      parts.push(negatedTargetKeywords(kws));
      i = next;
      continue;
    }
    if (notKeyword(op, "recipient") != null) {
      const [kws, next] = run(i, (o) => notKeyword(o, "recipient"));
      parts.push(`(excluding ${kws.map(capWord).join(" or ")} units)`);
      i = next;
      continue;
    }
    if (ownKeyword(op) != null) {
      const [kws, next] = run(i, ownKeyword);
      parts.push(kws.length >= 2 ? `if the unit is ${/^[AEIOU]/i.test(kws[0]!) ? "an" : "a"} ${kws.join(" ")} unit` : `if the unit has the ${kws[0]} keyword`);
      i = next;
      continue;
    }
    parts.push(conditionLeadIn(op));
    i++;
  }
  return parts.reduce((acc, part) => {
    if (acc === "") return part;
    // A second keyword gate on the same target narrows it: "against ORKS targets that are also VEHICLE".
    const target = /^against (.+) targets$/.exec(part);
    if (target && / targets$/.test(acc) && /(^|, )against /.test(acc)) return `${acc} that are also ${target[1]}`;
    return part.startsWith("against ") || part.startsWith("(excluding ") ? `${acc} ${part}` : `${acc}, ${part}`;
  }, "");
}
