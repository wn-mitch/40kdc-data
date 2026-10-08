import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { WEAPON_CHARACTERISTICS } from "./effect-families.js";
import { sameRun } from "./compile-attack-properties.js";
import { namesSelection } from "./compile-targeting-history.js";

const SCOPE = "weapon-property-scope";
const KEYWORD = "weapon-ability-keyword";
const isStat = (leaf: CompileLeaf) => (leaf.family_id === "characteristic-modifier" && leaf.family_version >= 5)
  || (leaf.family_id === "characteristic-set" && leaf.family_version >= 3);
const isProperty = (leaf: CompileLeaf) => isStat(leaf) || leaf.family_id === KEYWORD;

function between(source: Buffer | undefined, left: CompileLeaf, right: CompileLeaf): string {
  return source && left.end_byte !== undefined ? source.subarray(left.end_byte, right.start_byte).toString("utf8") : "";
}

function grantFrame(scope: CompileLeaf, firstKeyword?: CompileLeaf): CompileLeaf {
  return {
    ...scope, role: "EFFECT", family_id: "weapon-ability-grant", family_version: 5,
    ...(firstKeyword ? { start_byte: firstKeyword.start_byte, end_byte: firstKeyword.start_byte } : {}),
  };
}

function bindStat(leaf: CompileLeaf, scope: CompileLeaf): CompileLeaf {
  const characteristics = leaf.family_id === "characteristic-set"
    ? [leaf.parameters.characteristic as string]
    : leaf.parameters.characteristics as string[];
  if (!characteristics.every((stat) => (WEAPON_CHARACTERISTICS as readonly string[]).includes(stat))) {
    throw new CompileError("An attack-property scope cannot modify a model characteristic.");
  }
  for (const key of ["subject", "weapon_type"] as const) {
    if (leaf.parameters[key] !== undefined && leaf.parameters[key] !== scope.parameters[key]) {
      throw new CompileError(`Stat adjustment ${key} conflicts with its reviewed attack-property scope.`);
    }
  }
  return { ...leaf, parameters: { ...leaf.parameters, ...scope.parameters } };
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
    let containsStat = false;
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
      containsStat ||= isStat(leaf);
      end += 1;
    }
    // A qualifier after a single keyword with no stat adjustment ("[LETHAL HITS: CHARACTER]") gates the frame.
    const qualifier = !containsStat && end === first + 1 && list[first]!.family_id === KEYWORD ? qualifierOf(list, source, first, scope) : null;
    if (end === first) throw new CompileError("An attack-property scope needs a following weapon property in its clause.");
    const run = list.slice(first, end);
    // A scope for the bound weapon ("That weapon's attacks have") takes stat adjustments only: a keyword
    // grant has no bound weapon to name, and would widen to every weapon of the type.
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
    if (!containsStat) {
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
    let inKeywords = false;
    for (let at = first; at < end; at += 1) {
      const leaf = list[at]!;
      if (isStat(leaf)) {
        result.push(bindStat(leaf, scope));
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
