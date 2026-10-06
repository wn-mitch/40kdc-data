import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { mergeStackedFilters } from "../src/round5c/compile-unit-filters.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and keywords only; no GW rule prose.

const normalize = (family: string, parameters: Record<string, unknown>, version = currentFamilyVersion(family)) => normalizeFingerprintParameters(family, parameters, version);

/** Leaves on their own wording in `text`, in order, each in `fragment`. */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>, string?]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalize(family, parameters), start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
}

function compiled(list: CompileLeaf[], text: string) {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}

const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const authored = (JSON.parse(readFileSync(join(enrichment, "aeldari", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((item) => item.ability_id === "dance-of-distortion-aeldari")!;

const ALPHA_OR_BETA_GAMMA = [{ keywords: ["ALPHA"] }, { keywords: ["BETA", "GAMMA"] }];

describe("unit-filter alternatives (family)", () => {
  it("normalizes alternatives to one canonical order and spelling, a state-only alternative included", () => {
    const one = normalize("unit-filter", { side: "friendly", alternatives: [{ keywords: ["**gamma**", "beta"] }, { states: ["battle-shocked"] }, { keywords: ["ALPHA"] }] });
    const other = normalize("unit-filter", { side: "friendly", alternatives: [{ keywords: ["ALPHA"] }, { states: ["battle-shocked"] }, { keywords: ["BETA", "GAMMA"] }] });
    expect(one).toEqual(other);
    expect(one.alternatives).toEqual([{ keywords: ["ALPHA"] }, { keywords: ["BETA", "GAMMA"] }, { states: ["battle-shocked"] }]);
  });

  it("accepts a keyword outside ASCII, as a plain unit-filter keyword does", () => {
    expect(normalize("unit-filter", { side: "friendly", alternatives: [{ keywords: ["BRÔKA"] }, { keywords: ["DELTA"] }] }).alternatives).toEqual([{ keywords: ["BRÔKA"] }, { keywords: ["DELTA"] }]);
  });

  it("refuses alternatives that are not distinct alternatives", () => {
    const refuse = (parameters: Record<string, unknown>) => () => normalize("unit-filter", { side: "friendly", ...parameters });
    expect(refuse({ alternatives: [{ keywords: ["ALPHA"] }] })).toThrow(/two or more/u);
    expect(refuse({ alternatives: ALPHA_OR_BETA_GAMMA, any_keywords: ["DELTA", "EPSILON"] })).toThrow(/replaces any_keywords/u);
    expect(refuse({ keywords: ["ALPHA"], alternatives: [{ keywords: ["ALPHA", "BETA"] }, { keywords: ["GAMMA"] }] })).toThrow(/repeats a keyword the filter itself requires/u);
    // "ALPHA or ALPHA BETA": every ALPHA BETA unit is an ALPHA unit.
    expect(refuse({ alternatives: [{ keywords: ["ALPHA"] }, { keywords: ["ALPHA", "BETA"] }] })).toThrow(/adds nothing/u);
    expect(refuse({ alternatives: [{}, { keywords: ["ALPHA"] }] })).toThrow(/at least one/u);
    expect(refuse({ alternatives: [{ keywords: ["ALPHA"] }, { keywords: ["ALPHA"] }] })).toThrow(/twice/u);
    expect(refuse({ states: ["not-battle-shocked"], alternatives: [{ keywords: ["ALPHA"] }, { states: ["battle-shocked"] }] })).toThrow(/both battle-shocked and not-battle-shocked/u);
    expect(refuse({ alternatives: [{ keywords: ["ALPHA"], excluded_keywords: ["ALPHA"] }, { keywords: ["BETA"] }] })).toThrow(/requires and excludes/u);
  });

  it("is a new version: the previous unit-filter version has no alternatives", () => {
    // Version 5 added alternatives (family-extensions-11.ts); version 4 has none.
    expect(() => normalize("unit-filter", { side: "friendly", alternatives: ALPHA_OR_BETA_GAMMA }, 4)).toThrow();
  });

  it("puts unit-position's alternatives on the matching-unit form only", () => {
    const base = { kind: "within", inches: 3, subject: "this-unit", negated: false };
    expect(normalize("unit-position", { ...base, of: "matching-unit", of_side: "friendly", of_alternatives: ALPHA_OR_BETA_GAMMA }).of_alternatives).toEqual(ALPHA_OR_BETA_GAMMA);
    expect(() => normalize("unit-position", { ...base, of: "this-model", of_alternatives: ALPHA_OR_BETA_GAMMA })).toThrow(/matching-unit/u);
    expect(() => normalize("unit-position", { ...base, of: "matching-unit", of_side: "friendly", of_keywords: ["ALPHA"], of_alternatives: [{ keywords: ["ALPHA"] }, { keywords: ["BETA"] }] })).toThrow(/repeats/u);
  });
});

describe("unit-filter alternatives (compilation)", () => {
  it("lowers an effect's filtered units to any_of_filters, which the DSL schema accepts", () => {
    const text = "Friendly ALPHA or BETA GAMMA units gain the DELTA keyword.";
    const result = compiled(placed(text,
      ["Friendly ALPHA or BETA GAMMA units", "unit-filter", { side: "friendly", alternatives: ALPHA_OR_BETA_GAMMA }],
      ["gain the DELTA keyword", "keyword-grant", { subject: "antecedent", keywords: ["DELTA"] }]), text);
    const grant = nodes(result.mechanics, (node) => node.type === "keyword-grant")[0]!;
    expect(grant.target).toEqual({ owner: "friendly", any_of_filters: [{ all_of: ["ALPHA"] }, { all_of: ["BETA", "GAMMA"] }] });
    expect(checkEntry(entryWithMechanics(authored, result.mechanics)).errors).toEqual([]);
  });

  it("keeps the any-of when every alternative is one keyword and nothing else", () => {
    const text = "Friendly ALPHA or BETA units gain the DELTA keyword.";
    const result = compiled(placed(text,
      ["Friendly ALPHA or BETA units", "unit-filter", { side: "friendly", alternatives: [{ keywords: ["ALPHA"] }, { keywords: ["BETA"] }] }],
      ["gain the DELTA keyword", "keyword-grant", { subject: "antecedent", keywords: ["DELTA"] }]), text);
    expect(nodes(result.mechanics, (node) => node.type === "keyword-grant")[0]!.target).toEqual({ owner: "friendly", any_of: ["ALPHA", "BETA"] });
  });

  it("keeps each alternative's own state on a Stratagem target instead of applying it to every unit", () => {
    const text = "Your Shooting phase.\nOne friendly ALPHA/unengaged BETA GAMMA unit.\nOne model in your unit regains 1 lost wound.";
    const result = compiled(placed(text,
      ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["friendly ALPHA/unengaged BETA GAMMA unit", "unit-filter", { side: "friendly", alternatives: [{ keywords: ["ALPHA"] }, { keywords: ["BETA", "GAMMA"], states: ["unengaged"] }] }, "TARGET"],
      ["One model in your unit regains 1 lost wound", "regain-wounds", { subject: "this-unit", amount: "1" }, "EFFECT"]), text);
    const restrictions = (result.core as Record<string, unknown>).target_restrictions as Record<string, unknown>;
    expect(restrictions.required_keywords).toBeUndefined();
    expect(restrictions.eligibility).toEqual({ operator: "or", operands: [
      { type: "has-keyword", parameters: { all_of: ["ALPHA"] } },
      { operator: "and", operands: [{ type: "has-keyword", parameters: { all_of: ["BETA", "GAMMA"] } }, { operator: "not", operands: [{ type: "unit-state", parameters: { state: "engaged" } }] }] },
    ] });
  });

  it("checks a selection's alternatives in its eligibility", () => {
    const text = "Select one friendly ALPHA or BETA GAMMA unit. That unit gains the DELTA keyword.";
    const result = compiled(placed(text,
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["friendly ALPHA or BETA GAMMA unit", "unit-filter", { side: "friendly", alternatives: ALPHA_OR_BETA_GAMMA }],
      ["That unit gains the DELTA keyword", "keyword-grant", { subject: "antecedent", keywords: ["DELTA"] }]), text);
    const selection = nodes(result.mechanics, (node) => node.type === "select-units")[0]!;
    expect((selection.selector as Record<string, unknown>).keywords).toBeUndefined();
    expect((selection.selector as Record<string, unknown>).eligibility).toEqual({ operator: "or", operands: [
      { type: "has-keyword", parameters: { all_of: ["ALPHA"] } }, { type: "has-keyword", parameters: { all_of: ["BETA", "GAMMA"] } },
    ] });
  });

  it("refuses an aura over alternatives rather than reaching the union of their keywords", () => {
    const text = "While a friendly ALPHA or BETA GAMMA unit is within 6\" of this unit, that unit gains the DELTA keyword.";
    const result = compileLeaves(placed(text,
      ["friendly ALPHA or BETA GAMMA unit", "unit-filter", { side: "friendly", alternatives: ALPHA_OR_BETA_GAMMA }],
      ["within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
      ["that unit gains the DELTA keyword", "keyword-grant", { subject: "antecedent", keywords: ["DELTA"] }]), text);
    expect(result.ok ? [] : result.errors.join()).toMatch(/alternatives that differ by more than one keyword/u);
  });

  it("checks an attack's target against any one alternative", () => {
    const text = "Each time a model in this unit makes an attack that targets an ALPHA or BETA GAMMA unit, add 1 to the Hit roll.";
    const result = compiled(placed(text,
      ["Each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["ALPHA or BETA GAMMA unit", "unit-filter", { side: "enemy", alternatives: ALPHA_OR_BETA_GAMMA }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(JSON.stringify(result.mechanics)).toContain(JSON.stringify({ operator: "or", operands: [
      { type: "has-keyword", parameters: { all_of: ["ALPHA"], subject: "defender" } }, { type: "has-keyword", parameters: { all_of: ["BETA", "GAMMA"], subject: "defender" } },
    ] }));
  });

  it("measures a distance to a unit of any one alternative", () => {
    const text = "While this unit is within 3\" of one or more friendly ALPHA or BETA GAMMA units, this unit gains the DELTA keyword.";
    const result = compiled(placed(text,
      ["within 3\" of one or more friendly ALPHA or BETA GAMMA units", "unit-position", { kind: "within", inches: 3, subject: "this-unit", negated: false, of: "matching-unit", of_side: "friendly", of_alternatives: ALPHA_OR_BETA_GAMMA }],
      ["this unit gains the DELTA keyword", "keyword-grant", { subject: "this-unit", keywords: ["DELTA"] }]), text);
    const within = nodes(result.mechanics, (node) => node.type === "within")[0]!;
    expect((within.parameters as Record<string, unknown>).of).toEqual({ owner: "friendly", any_of_filters: [{ all_of: ["ALPHA"] }, { all_of: ["BETA", "GAMMA"] }] });
    expect(checkEntry(entryWithMechanics(authored, result.mechanics)).errors).toEqual([]);
  });
});

describe("unit-filter alternatives written as separate filters", () => {
  const filters = (text: string, ...items: Array<[string, Record<string, unknown>]>) => placed(text, ...items.map(([wording, extra]) => [wording, "unit-filter", { side: "friendly", ...extra }] as [string, string, Record<string, unknown>]));

  it("keeps a state that only one alternative names on that alternative", () => {
    const text = "a friendly **ALPHA** or Battle-shocked unit";
    const merged = mergeStackedFilters(filters(text, ["**ALPHA**", { keywords: ["ALPHA"] }], ["Battle-shocked unit", { states: ["battle-shocked"] }]), text);
    expect(merged[0]!.parameters).toEqual({ side: "friendly", alternatives: [{ keywords: ["ALPHA"] }, { states: ["battle-shocked"] }] });
  });

  it("narrows every alternative with a filter right after them, and refuses one that contradicts an alternative", () => {
    const text = "**ALPHA** or **BETA GAMMA** unit (excluding **DELTA** units)";
    const [alpha, beta] = filters(text, ["**ALPHA**", { keywords: ["ALPHA"] }], ["**BETA GAMMA** unit", { keywords: ["BETA", "GAMMA"] }]);
    const single = { ...alpha!, end_byte: beta!.end_byte, parameters: normalize("unit-filter", { side: "friendly", alternatives: ALPHA_OR_BETA_GAMMA }) };
    const [exclusion] = filters(text, ["excluding **DELTA** units", { excluded_keywords: ["DELTA"] }]);
    expect(mergeStackedFilters([single, exclusion!], text)[0]!.parameters).toEqual({ side: "friendly", excluded_keywords: ["DELTA"], alternatives: ALPHA_OR_BETA_GAMMA });
    const [contradiction] = filters("(excluding **ALPHA** units)", ["excluding **ALPHA** units", { excluded_keywords: ["ALPHA"] }]);
    expect(() => mergeStackedFilters([single, { ...contradiction!, start_byte: exclusion!.start_byte, end_byte: exclusion!.end_byte }], text)).toThrow(/contradicts or repeats/u);
  });

  it("refuses alternatives that differ in an ability exclusion, which only the whole filter can carry", () => {
    const text = "**ALPHA** or **BETA** unit";
    expect(() => mergeStackedFilters(filters(text, ["**ALPHA**", { keywords: ["ALPHA"], excluded_abilities: ["lone-operative"] }], ["**BETA** unit", { keywords: ["BETA"] }]), text))
      .toThrow(/abilities/u);
  });

  it("refuses an alternative that names nothing beyond what every alternative names", () => {
    const text = "**ALPHA** or **ALPHA BETA** unit";
    expect(() => mergeStackedFilters(filters(text, ["**ALPHA**", { keywords: ["ALPHA"] }], ["**ALPHA BETA** unit", { keywords: ["ALPHA", "BETA"] }]), text)).toThrow(/names nothing/u);
  });
});

describe("unit-filter alternatives (describer and cruncher)", () => {
  const scope = { duration: "resolution" };
  const grant = (target: Record<string, unknown>) => describeAbility({ effect: { type: "keyword-grant", target, modifier: { keywords: ["DELTA"] } }, scope } as never);

  it("reads keyword-only alternatives as \"A or B C units\", distinct from an any-of", () => {
    expect(grant({ owner: "friendly", any_of_filters: [{ all_of: ["ALPHA"] }, { all_of: ["BETA", "GAMMA"] }] })).toContain("all friendly ALPHA or BETA GAMMA units gain the DELTA keyword");
    expect(grant({ owner: "friendly", any_of: ["ALPHA", "BETA"] })).toContain("all friendly units with the ALPHA or BETA keyword");
  });

  it("names each alternative in full when one has more than keywords or the filter has keywords of its own", () => {
    expect(grant({ owner: "enemy", any_of_filters: [{ all_of: ["ALPHA"] }, { state: "battle-shocked" }] })).toContain("all enemy units that are ALPHA units or units that are Battle-shocked");
    expect(grant({ owner: "friendly", all_of: ["ALPHA"], any_of_filters: [{ all_of: ["BETA"], none_of: ["DELTA"] }, { all_of: ["GAMMA", "EPSILON"] }] }))
      .toContain("all friendly ALPHA units that are BETA units (excluding DELTA units) or GAMMA EPSILON units");
  });

  it("names the alternatives a trigger's unit must be", () => {
    const text = describeAbility({ trigger: { event: "destroyed", subject: { owner: "friendly", level: "model", any_of_filters: [{ all_of: ["ALPHA"] }, { all_of: ["BETA", "GAMMA"] }] } }, effect: { type: "feel-no-pain", target: "this-unit", modifier: { threshold: 6 } }, scope } as never);
    expect(text).toContain("(the triggering model must be an ALPHA model or a BETA GAMMA model)");
  });

  const reroll = { type: "re-roll", target: { owner: "friendly", any_of_filters: [{ all_of: ["ALPHA"] }, { all_of: ["BETA", "GAMMA"] }] }, modifier: { roll: "hit", result_scope: "any-result" } };
  const source = { kind: "ability", abilityId: "fabricated", abilityKind: "unit" } as const;

  it("buffs a unit that matches any one alternative, and only that", () => {
    expect(effectToBuffs(reroll, source, { phase: "shooting", attackerKeywords: ["BETA", "GAMMA"] }).applied).toHaveLength(1);
    expect(effectToBuffs(reroll, source, { phase: "shooting", attackerKeywords: ["ALPHA"] }).applied).toHaveLength(1);
    // BETA alone is neither ALPHA nor BETA GAMMA: the union of keywords would wrongly match it.
    const none = effectToBuffs(reroll, source, { phase: "shooting", attackerKeywords: ["BETA"] });
    expect(none.applied).toEqual([]);
    expect(none.unsupported).toEqual([]);
  });

  it("reports the buff as unsupported when the keywords are missing or an unmatched alternative names a state", () => {
    expect(effectToBuffs(reroll, source, { phase: "shooting" }).unsupported).toHaveLength(1);
    const stated = { ...reroll, target: { owner: "friendly", any_of_filters: [{ all_of: ["ALPHA"] }, { state: "battle-shocked" }] } };
    expect(effectToBuffs(stated, source, { phase: "shooting", attackerKeywords: ["BETA"] }).unsupported).toHaveLength(1);
    expect(effectToBuffs(stated, source, { phase: "shooting", attackerKeywords: ["ALPHA"] }).applied).toHaveLength(1);
  });

  it("drops the buff when an alternative's keywords fail, whatever state it also names", () => {
    const stated = { ...reroll, target: { owner: "friendly", any_of_filters: [{ all_of: ["ALPHA"] }, { all_of: ["DELTA"], state: "battle-shocked" }] } };
    const none = effectToBuffs(stated, source, { phase: "shooting", attackerKeywords: ["BETA"] });
    expect(none).toMatchObject({ applied: [], unsupported: [] });
    expect(effectToBuffs(stated, source, { phase: "shooting", attackerKeywords: ["DELTA"] }).unsupported).toHaveLength(1);
  });
});
