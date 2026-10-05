import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { WEAPON_CHARACTERISTICS } from "./effect-families.js";

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
  if (leaf.role !== "CONDITION" || leaf.fragment !== scope.fragment || !TARGET_CONDITIONS.has(leaf.family_id)) return false;
  const subject = leaf.parameters.subject;
  // A designation with no subject in this position names the attacks' target ("that target a busted unit").
  return leaf.family_id === "target-is-selected" || leaf.family_id === "unit-filter-target" || (leaf.family_id === "designated-filter" && subject === undefined)
    || (typeof subject === "string" && TARGET_SUBJECTS.has(subject));
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
    while (first < list.length && targetCondition(list[first]!, scope) && !/[.;]/u.test(between(source, list[first - 1]!, list[first]!))) {
      const leaf = list[first]!;
      gates.push(leaf.family_id === "designated-filter" && leaf.parameters.subject === undefined ? { ...leaf, parameters: { ...leaf.parameters, subject: "defender" } } : leaf);
      first += 1;
    }
    result.push(...gates);
    index = first - 1;
    let end = first;
    let containsStat = false;
    let choice = false;
    while (end < list.length && isProperty(list[end]!) && list[end]!.fragment === scope.fragment
      && !/[.;]/u.test(between(source, list[end - 1]!, list[end]!))) {
      containsStat ||= isStat(list[end]!);
      if (end > first && /\bor\b|[■▪•]/iu.test(between(source, list[end - 1]!, list[end]!))) choice = true;
      end += 1;
    }
    if (end === first) throw new CompileError("An attack-property scope needs a following weapon property in its clause.");
    if (!containsStat) {
      // Preserve the existing keyword-menu composition rules.
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
