import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { WEAPON_CHARACTERISTICS } from "./effect-families.js";
import { sameRun } from "./compile-attack-properties.js";
import { namesSelection } from "./compile-targeting-history.js";
import { WEAPON_KEYWORDS } from "./family-extensions-2.js";

const SCOPE = "weapon-property-scope";
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
  if (!characteristics.every((stat) => (WEAPON_CHARACTERISTICS as readonly string[]).includes(stat))) {
    throw new CompileError("An attack-property scope cannot modify a model characteristic.");
  }
  checkScopeConflict(leaf, scope, ["subject", "weapon_type"]);
  checkScopeKeyword(scope);
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

function targetCondition(leaf: CompileLeaf, scope: CompileLeaf): boolean {
  if (leaf.role !== "CONDITION" || leaf.fragment !== scope.fragment || !TARGET_CONDITIONS.has(leaf.family_id) || namesSelection(leaf)) return false;
  const subject = leaf.parameters.subject;
  // A designation with no subject in this position names the attacks' target ("that target a busted unit").
  return leaf.family_id === "target-is-selected" || leaf.family_id === "unit-filter-target" || (leaf.family_id === "designated-filter" && subject === undefined)
    || (typeof subject === "string" && TARGET_SUBJECTS.has(subject));
}

/** "[LETHAL HITS: CHARACTER/MONSTER/VEHICLE]": the target qualifier after one keyword, joined by a colon. */
function qualifierOf(list: readonly CompileLeaf[], source: Buffer | undefined, keyword: number, scope: CompileLeaf): CompileLeaf | null {
  const leaf = list[keyword + 1];
  if (!leaf || leaf.family_id !== "unit-filter" || leaf.fragment !== scope.fragment || leaf.parameters.side !== "any") return null;
  if (!Array.isArray(leaf.parameters.any_keywords) || Object.keys(leaf.parameters).some((key) => key !== "side" && key !== "any_keywords")) return null;
  const gap = source === undefined || list[keyword]!.end_byte === undefined ? null : between(source, list[keyword]!, leaf);
  return gap !== null && /^\s*:\s*$/u.test(gap) ? { ...leaf, family_id: "unit-filter-target" } : null;
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

const isChoiceMarker = (leaf: CompileLeaf) => leaf.family_id === "instead" && leaf.parameters.choice === true;

/** One run may not both remove and grant the same ability ("Do not have Blast. Have Blast" is a contradiction). */
function refuseKeywordAndRemoval(run: readonly CompileLeaf[]): void {
  const granted = run.filter((leaf) => leaf.family_id === KEYWORD).map((leaf) => leaf.parameters.keyword);
  for (const removal of run.filter(isRemoval)) {
    if (granted.includes(removal.parameters.keyword)) {
      throw new CompileError(`A weapon ability is both removed and granted in one clause: ${String(removal.parameters.keyword)}.`);
    }
  }
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
    while (end < list.length && list[end]!.fragment === scope.fragment) {
      const leaf = list[end]!;
      if (isChoiceMarker(leaf)) {
        if (end === first || !choiceMarkerAfter(list, source, end)) break;
      } else if (!isProperty(leaf)) {
        break;
      } else if (end === first) {
        if (/[.;]/u.test(between(source, list[end - 1]!, leaf))) break;
      } else if (!isChoiceMarker(list[end - 1]!)) {
        // The stat after a choice marker was checked against the marker by choiceMarkerAfter.
        if (!sameRun(source, list[end - 1]!, leaf)) break;
        if (/\bor\b|[■▪•]/iu.test(between(source, list[end - 1]!, leaf))) choice = true;
      }
      containsBound ||= isBound(leaf);
      end += 1;
    }
    // A qualifier after a single keyword with no bound leaf ("[LETHAL HITS: CHARACTER]") gates the frame.
    const qualifier = !containsBound && end === first + 1 && list[first]!.family_id === KEYWORD ? qualifierOf(list, source, first, scope) : null;
    if (end === first) throw new CompileError("An attack-property scope needs a following weapon property in its clause.");
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
        result.push(qualifier, grantFrame(scope, list[first]!), list[first]!);
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
  && ["weapon", "weapon_name", "weapon_keyword", "incoming"].every((key) => leaf.parameters[key] === undefined);

/**
 * The index of the last leaf of the recipient chain after the scope at `at`, when the keyword run
 * right after the chain can take the scope. The chain is one friendly or enemy unit-filter, then
 * unit-owners of the same side. The run is one or more keywords in the scope's fragment, with no
 * sentence break between the chain and the run or between its keywords. Anything else is undefined.
 */
function recipientChainEnd(list: readonly CompileLeaf[], at: number, source: Buffer): number | undefined {
  const scope = list[at]!;
  const inScope = (index: number): boolean => list[index] !== undefined && list[index]!.fragment === scope.fragment;
  if (!inScope(at + 1) || list[at + 1]!.family_id !== "unit-filter") return undefined;
  const side = list[at + 1]!.parameters.side;
  if (side !== "friendly" && side !== "enemy") return undefined;
  let last = at + 1;
  while (inScope(last + 1) && list[last + 1]!.family_id === "unit-owner") {
    if (list[last + 1]!.parameters.owner !== side) return undefined;
    last += 1;
  }
  let keywords = 0;
  for (let next = last + 1; next < list.length && list[next]!.family_id === KEYWORD; next += 1) {
    const previous = list[next - 1]!;
    if (!inScope(next) || previous.end_byte === undefined || list[next]!.start_byte === undefined) return undefined;
    if (/[.;]/u.test(between(source, previous, list[next]!))) return undefined;
    keywords += 1;
  }
  return keywords > 0 ? last : undefined;
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
