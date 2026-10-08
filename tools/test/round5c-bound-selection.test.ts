import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEXT = "Select one friendly ALPHA model. Select one enemy BRAVO unit within 8 inches of that model. That unit suffers 1 mortal wound.";

/** A model named as "anchor", and an enemy unit within 8 inches of it, which suffers a mortal wound. */
const PAIR: Item[] = [
  ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "anchor" }],
  ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
  ["Select one enemy", "select-unit", { distance: "within", inches: 8, visible: false, within_of: "anchor" }],
  ["BRAVO unit", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }],
  ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
];

function resultOf(items: Item[], text = TEXT) {
  return compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-bound-selection" });
}

/** Every select-units selector in the compiled effect, outermost first. */
function selectorsOf(node: unknown, out: Record<string, any>[] = []): Record<string, any>[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((item) => selectorsOf(item, out)); return out; }
  const record = node as Record<string, any>;
  if (record.type === "select-units") out.push(record.selector);
  Object.values(record).forEach((value) => selectorsOf(value, out));
  return out;
}

describe("Round 5C bound selection: a unit measured from a named model", () => {
  it("nests the enemy selection in the model selection and binds the model's name", () => {
    const result = resultOf(PAIR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [outer, inner] = selectorsOf(result.mechanics.effect);
    expect(outer).toMatchObject({ target_kind: "model", bind_as: "anchor" });
    expect(inner).toMatchObject({ within_inches: 8, within_inches_from: { selection_var: "anchor" } });
    expect(inner.bind_as).toBeUndefined();
    // The effect names the inner selection, the unit that suffers the wound.
    expect(JSON.stringify(result.mechanics.effect)).toContain('"target":"selected-unit"');
  });

  it("binds visible_to the named model as its own selection reference", () => {
    const text = "Select one friendly ALPHA model. Select one enemy BRAVO unit that is visible to that model. That unit suffers 1 mortal wound.";
    const items: Item[] = [
      ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "anchor" }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["Select one enemy", "select-unit", { distance: "any", visible: false, visible_to: "anchor" }],
      ["BRAVO unit", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
    ];
    const result = resultOf(items, text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [, inner] = selectorsOf(result.mechanics.effect);
    expect(inner).toMatchObject({ visible_to: { selection_var: "anchor" } });
    expect(inner.within_inches_from).toBeUndefined();
  });

  it("refuses a reference to a selection the ability does not bind", () => {
    const items = PAIR.map((item): Item => item[1] === "select-unit" && item[2].within_of ? [item[0], item[1], { ...item[2], within_of: "other" }] : item);
    const result = resultOf(items);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain('"other", which this ability does not bind');
  });

  it("refuses a measured selection when the earlier selection binds no name", () => {
    const items = PAIR.map((item): Item => item[1] === "select-unit" && item[2].bind_as ? [item[0], item[1], { ...item[2], bind_as: undefined }] : item);
    const result = resultOf(items);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("bound by a name (bind_as)");
  });

  it("refuses a lone selection that names another selection", () => {
    const items = PAIR.slice(2);
    const result = resultOf(items, "Select one enemy BRAVO unit within 8 inches of that model. That unit suffers 1 mortal wound.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("selects one unit");
  });

  it("refuses a bound pair whose effects include an attack", () => {
    const withAttack: Item[] = [...PAIR.slice(0, 4), ["That unit suffers 1 mortal wound", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }]];
    const result = resultOf(withAttack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("not bound with it yet");
  });

  it("normalizes within_of only with a distance within, and only as a selection name", () => {
    expect(currentFamilyVersion("select-unit")).toBeGreaterThanOrEqual(3);
    expect(normalizeFingerprintParameters("select-unit", { distance: "within", inches: 8, visible: false, within_of: "anchor" }, currentFamilyVersion("select-unit")))
      .toMatchObject({ within_of: "anchor", inches: 8 });
    expect(() => normalizeFingerprintParameters("select-unit", { distance: "any", visible: false, within_of: "anchor" }, currentFamilyVersion("select-unit"))).toThrow(/distance within/u);
    expect(() => normalizeFingerprintParameters("select-unit", { distance: "within", inches: 8, visible: false, within_of: "Anchor Model" }, currentFamilyVersion("select-unit"))).toThrow(/lowercase selection name/u);
  });
});
