import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { WEAPON_CHARACTERISTICS } from "./effect-families.js";
import { momentNamesUnit } from "./compile-antecedent.js";
import { sameRun } from "./compile-attack-properties.js";
import { namesSelection } from "./compile-targeting-history.js";
import { WEAPON_KEYWORDS } from "./family-extensions-2.js";

const SCOPE = "weapon-property-scope";
/**
 * Stats a weapon-scope binds in place: the weapon characteristics, plus Range (a weapon's profile
 * characteristic that the family layer names beside them). Model characteristics stay refused.
 */
const WEAPON_STAT_SCOPE: readonly string[] = [...WEAPON_CHARACTERISTICS, "Range"];
const KEYWORD = "weapon-ability-keyword";
const REMOVAL = "weapon-ability-removal";
const isStat = (leaf: CompileLeaf) => (leaf.family_id === "characteristic-modifier" && leaf.family_version >= 5)
  || (leaf.family_id === "characteristic-set" && leaf.family_version >= 3);
/** A roll the scope's recipient makes with its weapons: the Hit, Wound or Damage roll of a roll-modifier. */
const isWeaponRoll = (leaf: CompileLeaf) => leaf.family_id === "roll-modifier" && leaf.parameters.rolls === undefined
  && ["hit", "wound", "damage"].includes(String(leaf.parameters.roll));
const isRemoval = (leaf: CompileLeaf) => leaf.family_id === REMOVAL;
/** A leaf the scope binds in place: a stat change, a weapon roll, or a removal. Each takes the scope's recipient and weapons. */
const isBound = (leaf: CompileLeaf) => isStat(leaf) || isWeaponRoll(leaf) || isRemoval(leaf);
const isProperty = (leaf: CompileLeaf) => isBound(leaf) || leaf.family_id === KEYWORD;

function between(source: Buffer | undefined, left: CompileLeaf, right: CompileLeaf): string {
  return source && left.end_byte !== undefined ? source.subarray(left.end_byte, right.start_byte).toString("utf8") : "";
}

function grantFrame(scope: CompileLeaf, firstKeyword?: CompileLeaf): CompileLeaf {
  return {
    ...scope, role: "EFFECT", family_id: "weapon-ability-grant", family_version: 5,
    ...(firstKeyword ? { start_byte: firstKeyword.start_byte, end_byte: firstKeyword.start_byte } : {}),
  };
}

/** A scope's weapon_keyword must be one the bound leaves can carry; the scope version already limits it to these. */
function checkScopeKeyword(scope: CompileLeaf): void {
  const keyword = scope.parameters.weapon_keyword;
  if (keyword !== undefined && !(WEAPON_KEYWORDS as readonly string[]).includes(String(keyword))) {
    throw new CompileError(`A weapon scope cannot select weapons by ${String(keyword)}.`);
  }
}

/** A leaf's own recipient or weapon type, when it names one, must match the scope it sits under. */
function checkScopeConflict(leaf: CompileLeaf, scope: CompileLeaf, keys: readonly string[]): void {
  for (const key of keys) {
    if (leaf.parameters[key] !== undefined && leaf.parameters[key] !== scope.parameters[key]) {
      throw new CompileError(`${leaf.family_id} ${key} conflicts with its reviewed attack-property scope.`);
    }
  }
}

function bindStat(leaf: CompileLeaf, scope: CompileLeaf): CompileLeaf {
  const characteristics = leaf.family_id === "characteristic-set"
    ? [leaf.parameters.characteristic as string]
    : leaf.parameters.characteristics as string[];
  if (!characteristics.every((stat) => WEAPON_STAT_SCOPE.includes(stat))) {
    throw new CompileError("An attack-property scope cannot modify a model characteristic.");
  }
  checkScopeConflict(leaf, scope, ["subject", "weapon_type"]);
  checkScopeKeyword(scope);
  // A stat change under a list of named weapons takes the list; a weapon name of its own would name a weapon outside it.
  if (scope.parameters.weapon_names !== undefined && leaf.parameters.weapon_name !== undefined) {
    throw new CompileError(`${leaf.family_id} weapon_name conflicts with the reviewed named-weapon scope.`);
  }
  return { ...leaf, parameters: { ...leaf.parameters, ...scope.parameters } };
}

/**
 * "Your unit's Hit rolls …" under a scope: the roll takes the scope's recipient and weapon type. The
 * DSL's roll modifier has no weapon keyword, so a keyword scope cannot carry a roll.
 */
function bindRoll(leaf: CompileLeaf, scope: CompileLeaf): CompileLeaf {
  if (scope.parameters.weapon_keyword !== undefined) {
    throw new CompileError("A roll modifier cannot be scoped to weapons by a keyword; the DSL roll modifier has no weapon_keyword.");
  }
  if (scope.parameters.weapon_names !== undefined) throw new CompileError("A roll modifier cannot be scoped to named weapons; the DSL roll modifier takes no weapon name.");
  checkScopeConflict(leaf, scope, ["subject", "weapon_type"]);
  return { ...leaf, parameters: { ...leaf.parameters, subject: scope.parameters.subject, weapon_type: scope.parameters.weapon_type } };
}

/**
 * "Do not have [Blast]" under a scope: the weapons the scope selects lose the ability. The recipient
 * and weapon type come from the scope; a weapon_keyword selector is carried through for the DSL.
 */
function bindRemoval(leaf: CompileLeaf, scope: CompileLeaf): CompileLeaf {
  if (scope.parameters.subject === undefined) throw new CompileError("A weapon ability removal has no recipient; it needs a weapon-property scope before it.");
  checkScopeKeyword(scope);
  if (scope.parameters.weapon_names !== undefined) throw new CompileError("A weapon ability removal cannot be scoped to named weapons; the DSL removal takes no weapon name.");
  const keyword = scope.parameters.weapon_keyword;
  return {
    ...leaf,
    parameters: {
      keyword: leaf.parameters.keyword, subject: scope.parameters.subject, weapon_type: scope.parameters.weapon_type,
      ...(keyword !== undefined ? { weapon_keyword: keyword } : {}),
    },
  };
}

/** Bind a property's explicit recipient and weapon scope, without changing the reviewed operand. */
/** Conditions on the attack's target that can sit between a scope and its property ("that target a marked unit"). */
const TARGET_CONDITIONS = new Set(["target-is-selected", "designated-filter", "unit-mark", "unit-keyword", "unit-position", "unit-state", "unit-filter-target"]);
const TARGET_SUBJECTS = new Set(["target", "defender"]);

/**
 * "weapons that targeted an enemy unit within 12\"": the attack the scope's own unit makes, which the
 * target gate after it describes. The attack names no weapon and no target of its own, so it is
 * admitted by family alone, whatever role the record gives it.
 */
function attackGate(leaf: CompileLeaf, scope: CompileLeaf): boolean {
  return leaf.family_id === "attack" && leaf.fragment === scope.fragment && leaf.parameters.direction === "makes"
    && leaf.parameters.unit === scope.parameters.subject;
}

/** "an enemy unit" in a scope's gate: a side-only unit-filter that says nothing the gate after it does not. */
function sideOnlyEnemy(leaf: CompileLeaf, scope: CompileLeaf): boolean {
  return leaf.family_id === "unit-filter" && leaf.fragment === scope.fragment && leaf.parameters.side === "enemy"
    && Object.keys(leaf.parameters).length === 1;
}

export function targetCondition(leaf: CompileLeaf, scope: CompileLeaf): boolean {
  if (attackGate(leaf, scope) || sideOnlyEnemy(leaf, scope)) return true;
  if (leaf.role !== "CONDITION" || leaf.fragment !== scope.fragment || !TARGET_CONDITIONS.has(leaf.family_id) || namesSelection(leaf)) return false;
  const subject = leaf.parameters.subject;
  // A designation with no subject in this position names the attacks' target ("that target a busted unit").
  return leaf.family_id === "target-is-selected" || leaf.family_id === "unit-filter-target" || (leaf.family_id === "designated-filter" && subject === undefined)
    || (typeof subject === "string" && TARGET_SUBJECTS.has(subject));
}

/**
 * "[LETHAL HITS: CHARACTER/MONSTER/VEHICLE]": the target qualifier after one keyword, joined by a colon.
 * The qualifier is a unit-filter with side any and exactly one of any_keywords or excluded_keywords.
 * The gap may hold the colon, spaces and emphasis asterisks ("`: **`") and nothing else, so a
 * sentence break or a word between the keyword and the qualifier refuses it.
 */
export function qualifierOf(list: readonly CompileLeaf[], source: Buffer | undefined, keyword: number, fragment: string | undefined): CompileLeaf | null {
  const leaf = list[keyword + 1];
  if (!leaf || leaf.family_id !== "unit-filter" || leaf.fragment !== fragment || leaf.parameters.side !== "any") return null;
  const keys = Object.keys(leaf.parameters).filter((key) => key !== "side");
  if (keys.length !== 1 || (keys[0] !== "any_keywords" && keys[0] !== "excluded_keywords") || !Array.isArray(leaf.parameters[keys[0]!])) return null;
  const gap = source === undefined || list[keyword]!.end_byte === undefined ? null : between(source, list[keyword]!, leaf);
  return gap !== null && /^[\s*]*:[\s*]*$/u.test(gap) ? { ...leaf, family_id: "unit-filter-target" } : null;
}

/** "[CLEAVE 1]. Or: +1 AP": a choice marker between a keyword and the stat adjustment after it, with the sentence break a printed "Or:" starts. */
function choiceMarkerAfter(list: readonly CompileLeaf[], source: Buffer | undefined, at: number): boolean {
  const marker = list[at]!;
  const keyword = list[at - 1];
  const stat = list[at + 1];
  if (!isChoiceMarker(marker) || keyword?.family_id !== KEYWORD || !stat || !isStat(stat) || stat.fragment !== marker.fragment) return false;
  if (keyword.fragment !== marker.fragment) return false;
  return (source === undefined || /^[\]*]*\.?\s*$/u.test(between(source, keyword, marker))) && sameRun(source, marker, stat);
}

/** "Or:" that opens an option, and the bullet marks that start one. */
const OPTION_OPENER = /\bor\s*:/iu;
const OPTION_BOUNDARY = /\bor\s*:|[■▪•]/iu;
const isChoiceMarker = (leaf: CompileLeaf) => leaf.family_id === "instead" && leaf.parameters.choice === true;

/**
 * The leaf after a scope's run that starts an alternative ("... have +1 to hit rolls. Or: Attacks that
 * target this unit have -1 to hit rolls"). A subjectless attack roll there has no recipient: the scope
 * binds only the run before the "Or:", and the default would give the roll to this unit's own attacks.
 */
function refuseAlternativeRoll(before: CompileLeaf, roll: CompileLeaf, source: Buffer | undefined): void {
  if (!isWeaponRoll(roll) || roll.parameters.subject !== undefined || roll.fragment !== before.fragment) return;
  if (/\bor\b/iu.test(between(source, before, roll))) {
    throw new CompileError(`A ${String(roll.parameters.roll)} roll in an alternative after a weapon scope names no recipient, so it is not compiled.`);
  }
}

/**
 * The property after a bound run's "Or:" or bullet. The scope binds only the run before the option
 * boundary, and the choice that the boundary makes is not composed from these leaves, so a property
 * there refuses rather than being bound to the scope or left as a second, unchosen effect.
 */
function refuseOptionAfterRun(next: CompileLeaf, scope: CompileLeaf): void {
  if (next.fragment !== scope.fragment || !isProperty(next)) return;
  throw new CompileError("An attack-property choice containing stat adjustments needs an explicit composition relation.");
}

/** One run may not both remove and grant the same ability ("Do not have Blast. Have Blast" is a contradiction). */
function refuseKeywordAndRemoval(run: readonly CompileLeaf[]): void {
  const granted = run.filter((leaf) => leaf.family_id === KEYWORD).map((leaf) => leaf.parameters.keyword);
  for (const removal of run.filter(isRemoval)) {
    if (granted.includes(removal.parameters.keyword)) {
      throw new CompileError(`A weapon ability is both removed and granted in one clause: ${String(removal.parameters.keyword)}.`);
    }
  }
}

/** "equipped by …" in a scope's own wording names the weapons' bearers; "by models in this unit" names this unit. */
const EQUIPPED_BY = /\bequipped by\b/iu;
/** "equipped by this model", "equipped by your models", "equipped by models in your unit": the bearers are this unit's. */
const BEARER_IS_THIS_UNIT = /\bequipped by (?:models in )?(?:this|that|your) (?:unit|models?)\b/iu;

/**
 * A scope whose wording says "equipped by" names the bearers of its weapons. The only leaves that
 * name them are a unit or model filter, a unit owner or a membership in the same fragment. With none
 * of those, the scope's recipient would be the only one left, and it would take the grant as its
 * own bearer. A scope hoisted onto its recipient chain has no wording left here and keeps that chain.
 */
function refuseUnnamedBearers(list: readonly CompileLeaf[], scope: CompileLeaf, source: Buffer | undefined): void {
  // "weapons equipped by models in the attacking unit": the subject already names the bearers' unit, but only
  // a moment earlier in the record gives event-subject a unit to be.
  if (scope.parameters.subject === "event-subject") {
    const at = list.indexOf(scope);
    if (!list.some((leaf, other) => other < at && momentNamesUnit(list, other))) {
      throw new CompileError("A weapon-property scope names the triggering unit, but no earlier leaf names a moment's unit.");
    }
    return;
  }
  if (source === undefined || scope.start_byte === undefined || scope.end_byte === undefined || scope.end_byte <= scope.start_byte) return;
  const wording = source.subarray(scope.start_byte, scope.end_byte).toString("utf8");
  if (!EQUIPPED_BY.test(wording) || BEARER_IS_THIS_UNIT.test(wording)) return;
  const named = list.some((leaf) => leaf.fragment === scope.fragment && (leaf.family_id === "unit-owner" || leaf.family_id === "membership"
    || (leaf.family_id === "unit-filter" && leaf.parameters.side !== "any")));
  if (!named) throw new CompileError("A weapon scope names its bearers (\"equipped by …\") with no unit or model filter for them; it is not compiled.");
}

export function foldWeaponScopes(list: readonly CompileLeaf[], sourceText?: string): readonly CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === SCOPE)) return list;
  const source = sourceText === undefined ? undefined : Buffer.from(sourceText, "utf8");
  const result: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const scope = list[index]!;
    if (scope.family_id !== SCOPE) { result.push(scope); continue; }
    // "Attacks that target a marked unit have [LETHAL HITS]": the target's conditions gate the
    // properties after them, so they stay in front of the frame the scope becomes.
    let first = index + 1;
    const gates: CompileLeaf[] = [];
    // A duration between them ("until the end of the phase, have [LETHAL HITS]") keeps its place too.
    while (first < list.length && (targetCondition(list[first]!, scope) || (gates.length > 0 && list[first]!.role === "DURATION" && list[first]!.fragment === scope.fragment))
      && !/[.;]/u.test(between(source, list[first - 1]!, list[first]!))) {
      const leaf = list[first]!;
      gates.push(leaf.family_id === "designated-filter" && leaf.parameters.subject === undefined ? { ...leaf, parameters: { ...leaf.parameters, subject: "defender" } } : leaf);
      first += 1;
    }
    result.push(...gates);
    index = first - 1;
    let end = first;
    let containsBound = false;
    let choice = false;
    let boundaryStop = false;
    while (end < list.length && list[end]!.fragment === scope.fragment) {
      const leaf = list[end]!;
      if (isChoiceMarker(leaf)) {
        if (end === first || !choiceMarkerAfter(list, source, end)) break;
      } else if (!isProperty(leaf)) {
        break;
      } else if (end === first) {
        const gap = between(source, list[end - 1]!, leaf);
        if (/[.;]/u.test(gap) || OPTION_OPENER.test(gap)) break;
      } else if (!isChoiceMarker(list[end - 1]!)) {
        // The stat after a choice marker was checked against the marker by choiceMarkerAfter.
        if (!sameRun(source, list[end - 1]!, leaf)) break;
        const gap = between(source, list[end - 1]!, leaf);
        // A bound run ends at an option boundary: the next option is not this scope's to bind.
        if (containsBound && OPTION_BOUNDARY.test(gap)) { boundaryStop = true; break; }
        if (/\bor\b|[■▪•]/iu.test(gap)) choice = true;
      }
      containsBound ||= isBound(leaf);
      end += 1;
    }
    if (end > first && end < list.length) refuseAlternativeRoll(list[end - 1]!, list[end]!, source);
    if (boundaryStop) refuseOptionAfterRun(list[end]!, scope);
    // A qualifier after a single keyword with no bound leaf ("[LETHAL HITS: CHARACTER]") gates the frame.
    const qualifier = !containsBound && end === first + 1 && list[first]!.family_id === KEYWORD ? qualifierOf(list, source, first, scope.fragment) : null;
    if (end === first) throw new CompileError("An attack-property scope needs a following weapon property in its clause.");
    refuseUnnamedBearers(list, scope, source);
    const run = list.slice(first, end);
    // A scope for the bound weapon ("That weapon's attacks have") takes stat adjustments only: a keyword
    // grant or a removal has no bound weapon to name, and a roll is not a weapon's stat.
    if (scope.parameters.weapon !== undefined && run.some((leaf) => !isStat(leaf))) {
      throw new CompileError("A bound-weapon scope takes stat adjustments only; a keyword grant to that weapon is not compiled yet.");
    }
    if (run.some(isChoiceMarker)) {
      // "can have: [CLEAVE 1]. Or: +1 AP": the keyword and the stat adjustment are the two options; the
      // stat adjustment takes the scope's recipient and weapon type, as it does in any scope.
      const [keyword, marker, stat] = run;
      if (run.length !== 3 || keyword!.family_id !== KEYWORD || !isChoiceMarker(marker!) || !isStat(stat!)) {
        throw new CompileError("An attack-property choice containing stat adjustments needs an explicit composition relation.");
      }
      result.push(grantFrame(scope, keyword), keyword!, marker!, bindStat(stat!, scope));
      index = end - 1;
      continue;
    }
    if (!containsBound) {
      // Preserve the existing keyword-menu composition rules.
      if (qualifier) {
        // The qualifier gates this one grant only (`gate`, read by the effect fragment), not the steps after it.
        const frame = grantFrame(scope, list[first]!);
        result.push({ ...frame, parameters: { ...frame.parameters, gate: qualifier } }, list[first]!);
        index = end;
        continue;
      }
      result.push(grantFrame(scope));
      continue;
    }
    if (choice) {
      throw new CompileError("An attack-property choice containing stat adjustments needs an explicit composition relation.");
    }
    refuseKeywordAndRemoval(list.slice(first, end));
    let inKeywords = false;
    for (let at = first; at < end; at += 1) {
      const leaf = list[at]!;
      if (isStat(leaf)) {
        result.push(bindStat(leaf, scope));
        inKeywords = false;
      } else if (isRemoval(leaf)) {
        result.push(bindRemoval(leaf, scope));
        inKeywords = false;
      } else if (isWeaponRoll(leaf)) {
        result.push(bindRoll(leaf, scope));
        inKeywords = false;
      } else {
        if (!inKeywords) result.push(grantFrame(scope, leaf));
        result.push(leaf);
        inKeywords = true;
      }
    }
    index = end - 1;
  }
  return result;
}

/**
 * A weapon scope with no weapon of its own: "Ranged weapons equipped by …" before its recipient
 * chain. Scopes are placed by byte order, so the scope would sort ahead of the filter that names
 * its weapons' bearers, and the fold would find a filter where it needs a property.
 */
const isOpenScope = (leaf: CompileLeaf) => leaf.family_id === SCOPE && leaf.role === "CONDITION"
  && ["weapon", "weapon_name", "weapon_names", "weapon_keyword", "incoming"].every((key) => leaf.parameters[key] === undefined);

/**
 * The index of the last leaf of the recipient chain after the scope at `at`, when the run right
 * after the chain can take the scope. The chain is one friendly or enemy unit-filter, then
 * unit-owners of the same side, then at most one membership ("in this unit"). The run is either
 * one or more keywords, or a weapon characteristic setter followed by any keywords; in the scope's
 * fragment, with no sentence break between the chain and the run or between its keywords.
 * Anything else is undefined.
 */
function recipientChainEnd(list: readonly CompileLeaf[], at: number, source: Buffer): number | undefined {
  const scope = list[at]!;
  const inScope = (index: number): boolean => list[index] !== undefined && list[index]!.fragment === scope.fragment;
  if (!inScope(at + 1) || list[at + 1]!.family_id !== "unit-filter") return undefined;
  const side = list[at + 1]!.parameters.side;
  if (side !== "friendly" && side !== "enemy") return undefined;
  let last = at + 1;
  // Stacked filters of the same side ("K models (excluding L models) from your army") are one filter once merged (mergeStackedFilters).
  while (inScope(last + 1) && (list[last + 1]!.family_id === "unit-owner" || (list[last + 1]!.family_id === "unit-filter" && list[last + 1]!.parameters.side === side))) {
    if (list[last + 1]!.family_id === "unit-owner" && list[last + 1]!.parameters.owner !== side) return undefined;
    last += 1;
  }
  const membered = inScope(last + 1) && list[last + 1]!.family_id === "membership";
  if (membered) last += 1;
  // A weapon characteristic setter first: "in this unit" + "have an Attacks characteristic of 3", or
  // a setter with a keyword after it ("have an Attacks characteristic of 4 and the [HAZARDOUS] ability").
  // The scope takes it, as bindStat merges the scope's recipient into the stat. A bare setter after a
  // chain with no membership stays unhoisted.
  const stat = inScope(last + 1) ? list[last + 1] : undefined;
  const keywordAfter = stat !== undefined && inScope(last + 2) && list[last + 2]!.family_id === KEYWORD && sentenceJoined(source, stat, list[last + 2]!);
  const statFirst = stat !== undefined && isStat(stat) && weaponStat(stat) && sentenceJoined(source, list[last]!, stat) && (membered || keywordAfter);
  let keywords = 0;
  for (let next = last + 1; next < list.length && list[next]!.family_id === KEYWORD; next += 1) {
    const previous = list[next - 1]!;
    if (!inScope(next) || previous.end_byte === undefined || list[next]!.start_byte === undefined) return undefined;
    if (/[.;]/u.test(between(source, previous, list[next]!))) return undefined;
    keywords += 1;
  }
  return keywords > 0 || statFirst ? last : undefined;
}

/** A weapon characteristic setter's characteristics, all of them weapon characteristics. */
function weaponStat(leaf: CompileLeaf): boolean {
  const characteristics = leaf.family_id === "characteristic-set" ? [leaf.parameters.characteristic] : leaf.parameters.characteristics as unknown[];
  return characteristics.every((stat) => WEAPON_STAT_SCOPE.includes(String(stat)));
}

/** Whether two leaves sit in one sentence: no full stop or semicolon between them. */
function sentenceJoined(source: Buffer, left: CompileLeaf, right: CompileLeaf): boolean {
  return left.end_byte !== undefined && right.start_byte !== undefined && !/[.;]/u.test(between(source, left, right));
}

/**
 * Moves each open scope that has a recipient chain and keyword run to a zero-width place right
 * after its chain. The scope's text then ends at the chain, so the gap before the keyword is the
 * property's lead-in. Records with no source text, or no such scope, are returned unchanged.
 */
export function hoistWeaponRecipients(list: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  const result = [...list];
  if (sourceText === undefined) return result;
  const source = Buffer.from(sourceText, "utf8");
  for (let at = 0; at < result.length; at += 1) {
    const scope = result[at]!;
    if (!isOpenScope(scope)) continue;
    const last = recipientChainEnd(result, at, source);
    if (last === undefined) continue;
    const end = result[last]!.end_byte!;
    result.splice(at, 1);
    // Removing the scope moved the chain's last leaf to last - 1, so the scope goes in at `last`.
    result.splice(last, 0, { ...scope, start_byte: end, end_byte: end });
  }
  return result;
}
