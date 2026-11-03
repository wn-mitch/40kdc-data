/**
 * Weapon keyword references, the weapon selector every weapon-scoped modifier shares, and the
 * effect fragments that grant, remove or extend weapon abilities. `leafEffect()` in
 * `compile-fragments.ts` delegates here for those families.
 */

import { condition } from "./compile-conditions.js";
import { CompileError } from "./compile-error.js";
import { closed, type CompileLeaf, effect, type EffectContext, type TargetOf } from "./compile-fragments.js";
import type { KeywordOption } from "./compile-keyword-menu.js";

type Node = Record<string, unknown>;

/** Maps printed Anti target syntax to the structured catalog parameters consumed by the DSL. */
function antiParameters(target: string, threshold?: number): Record<string, unknown> {
  const required: string[] = [];
  const excluded: string[] = [];
  for (const raw of target.split("/")) {
    const keyword = raw.trim().toUpperCase();
    if (keyword.startsWith("NON-")) excluded.push(keyword.slice(4));
    else required.push(keyword);
  }
  const parameters: Record<string, unknown> = {};
  if (required.length === 1 && excluded.length === 0) parameters.target_keyword = required[0]!;
  else {
    if (required.length > 0) parameters.required_target_keywords_any = required;
    if (excluded.length > 0) parameters.excluded_target_keywords = excluded;
  }
  if (threshold !== undefined) parameters.threshold = threshold;
  return parameters;
}

/** Catalog-backed weapon keyword references at the source-leaf boundary. */
export function keywordRef(value: unknown): Node {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const antiSelector = /^anti-([A-Z][A-Z\s-]*(?:\/[A-Z][A-Z\s-]*)*)\s*$/iu.exec(trimmed);
    if (antiSelector) return { keyword_id: "anti", parameters: antiParameters(antiSelector[1]!.trim()) };
    const anti = /^anti-([A-Z][A-Z\s-]*(?:\/[A-Z][A-Z\s-]*)*)\s+(\d+)(?:\+|PLUS)?$/iu.exec(trimmed);
    if (anti) return { keyword_id: "anti", parameters: antiParameters(anti[1]!.trim(), Number(anti[2])) };
    const rated = /^(.+?)\s+(\d+|(?:\d+)?D\d+(?:[+-]\d+)?)$/iu.exec(trimmed);
    const name = rated?.[1] ?? trimmed;
    const keywordId = name.toLowerCase().replace(/[\s_]+/gu, "-").replace(/[^a-z0-9-]/gu, "");
    if (!keywordId) throw new CompileError("A weapon keyword must be a non-empty catalog name.");
    if (!rated) return { keyword_id: keywordId };
    const rating = rated[2]!;
    return { keyword_id: keywordId, parameters: { value: /^\d+$/u.test(rating) ? Number(rating) : rating.toUpperCase() } };
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "keyword_id" in value) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.keyword_id !== "string" || candidate.keyword_id === "") {
      throw new CompileError("A weapon keyword reference needs a catalog keyword_id.");
    }
    return candidate.parameters === undefined
      ? { keyword_id: candidate.keyword_id }
      : { keyword_id: candidate.keyword_id, parameters: candidate.parameters };
  }
  throw new CompileError("A weapon keyword must be a catalog name or reference.");
}

/** Canonical weapon selector shared by every modifier that narrows its affected weapons. */
export function weaponScope(leaf: CompileLeaf): Node {
  const selector = (value: unknown): Node | Node[] => {
    if (Array.isArray(value)) {
      if (value.length === 0) throw new CompileError("A weapon scope selector cannot be empty.");
      const refs = value.map((entry) => keywordRef(entry));
      return refs.length === 1 ? refs[0]! : refs;
    }
    return keywordRef(value);
  };
  const type = leaf.parameters.weapon_type === undefined ? "all" : closed(leaf, "weapon_type");
  const weapons: Node = {};
  if (type !== "all") weapons.type = type;
  if (leaf.parameters.weapon_name !== undefined) weapons.name = closed(leaf, "weapon_name");
  if (leaf.parameters.weapon_keyword !== undefined) weapons.keyword = selector(closed(leaf, "weapon_keyword"));
  if (leaf.parameters.weapon_var !== undefined) weapons.ref = { weapon_var: String(leaf.parameters.weapon_var) };
  else if (leaf.parameters.weapon_ref !== undefined) weapons.ref = closed(leaf, "weapon_ref");
  if (leaf.parameters.exclude_weapon_name !== undefined) weapons.exclude_name = closed(leaf, "exclude_weapon_name");
  if (leaf.parameters.exclude_weapon_keyword !== undefined) {
    weapons.exclude_keyword = selector(closed(leaf, "exclude_weapon_keyword"));
  }
  return Object.keys(weapons).length === 0 ? {} : { weapons };
}

/** The effect for a weapon-ability family, or undefined when the family is not one of them. */
export function weaponAbilityEffect(leaf: CompileLeaf, context: EffectContext, target: TargetOf): Node | undefined {
  switch (leaf.family_id) {
    case "weapon-ability-range": {
      // The range is a shared range reference; the keyword is a catalog selector.
      const range = leaf.parameters.range !== undefined ? closed(leaf, "range") : closed(leaf, "within");
      return { type: "weapon-ability-range", target: target(leaf.parameters.subject), modifier: { keyword: keywordRef(closed(leaf, "keyword")), range } };
    }
    case "weapon-ability-grant": {
      // A keyword gated by its own target qualifier (compile-weapon-keywords.ts): only this grant is conditional.
      if (leaf.parameters.gate !== undefined) {
        const { gate, ...rest } = leaf.parameters as Record<string, unknown> & { gate: CompileLeaf };
        return { type: "conditional", condition: condition(gate), effect: effect({ ...leaf, parameters: rest }, context) };
      }
      const ifPresent = leaf.parameters.if_present;
      const incoming = leaf.parameters.incoming;
      // A frame folded with its keyword leaves (compile-weapon-keywords.ts) carries `keywords`; a menu grants one of them.
      const rawKeywords = Array.isArray(leaf.parameters.keywords) ? leaf.parameters.keywords : [closed(leaf, "keyword")];
      const keywords = rawKeywords.map((value) => keywordRef(value));
      if (leaf.parameters.keyword_choice === true && Array.isArray(leaf.parameters.option_groups)) {
        // Options of one or more runs, each run with its own qualifier, under the group's opening condition (compile-keyword-menu.ts).
        const { keywords: _keywords, keyword_choice: _choice, choice_label: _label, option_groups: groups, ...frame } = leaf.parameters as Record<string, unknown> & { option_groups: KeywordOption[] };
        const menu: Node = { type: "choice", options: groups.map((group) => {
          const grants = group.keywords.map((keyword, at) => {
            const grant = effect({ ...leaf, parameters: { ...frame, keyword } }, context);
            const qualifier = group.qualifiers[at];
            return qualifier ? { type: "conditional", condition: condition(qualifier), effect: grant } : grant;
          });
          const body: Node = grants.length === 1 ? grants[0]! : { type: "sequence", steps: grants };
          return group.gate ? { type: "conditional", condition: condition(group.gate), effect: body } : body;
        }) };
        if (leaf.parameters.choice_label !== undefined) menu.choice_label = closed(leaf, "choice_label");
        return menu;
      }
      if (leaf.parameters.keyword_choice === true) {
        // A menu option may carry the target qualifier printed after it (compile-weapon-keywords.ts): that option is conditional.
        const { keywords: _keywords, keyword_choice: _choice, choice_label: _label, option_conditions: conditions, ...frame } = leaf.parameters as Record<string, unknown> & { option_conditions?: CompileLeaf[] };
        const menu: Node = { type: "choice", options: keywords.map((keyword, at) => {
          const grant = effect({ ...leaf, parameters: { ...frame, keyword } }, context);
          const qualifier = conditions?.[at];
          return qualifier ? { type: "conditional", condition: condition(qualifier), effect: grant } : grant;
        }) };
        // The opener's label for its menu (compile-weapon-keywords.ts carries it over when the opener is dropped).
        if (leaf.parameters.choice_label !== undefined) menu.choice_label = closed(leaf, "choice_label");
        return menu;
      }
      // A list of named weapons (compile-weapon-names.ts): the same grant to each weapon, one step per name.
      if (Array.isArray(leaf.parameters.weapon_names)) {
        const { weapon_names: names, ...rest } = leaf.parameters as Record<string, unknown> & { weapon_names: string[] };
        const steps = names.map((name) => effect({ ...leaf, parameters: { ...rest, weapon_name: name } }, context));
        return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
      }
      // Version 7: "that attack has the [X] ability" — the attack's weapon, whoever makes the attack.
      // A grant with no subject has no bearer: no unit names its weapons and no model filter follows its scope.
      if (leaf.parameters.subject === undefined) throw new CompileError("A weapon-ability-grant names no bearer: it has no unit and no model filter for its weapons.");
      const holder = leaf.parameters.subject === "attack" ? (context.incoming ? "attacker" : context.attacker ?? "this-unit") : target(leaf.parameters.subject);
      return {
        type: "weapon-ability-grant", target: holder,
        modifier: {
          keywords,
          ...weaponScope(leaf),
          ...(ifPresent !== undefined ? { if_present: ifPresent } : {}),
          ...(incoming === true ? { incoming: true } : {}),
        },
      };
    }
    case "weapon-ability-removal": {
      // "Do not have [Heavy]" under a scope (compile-weapon-scopes.ts bindRemoval): the scope's weapons lose it.
      const subject = leaf.parameters.subject;
      if (subject === undefined) throw new CompileError("A weapon ability removal has no recipient; it needs a weapon-property scope before it.");
      return {
        type: "weapon-ability-grant", target: target(subject),
        modifier: {
          removes: [keywordRef(closed(leaf, "keyword"))],
          ...weaponScope(leaf),
        },
      };
    }
    default:
      return undefined;
  }
}
