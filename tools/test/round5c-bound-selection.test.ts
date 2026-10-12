import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/family-extensions.js";
import { FAMILY_EXTENSIONS_20_SELECT_COUNT_POOL_AND_PAIRING } from "../src/round5c/family-extensions-20-select-count-pool-and-pairing.js";

/** The select-unit version just before the distance-free within_of extension (later extensions may sit above it). */
function previousSelectUnit(): number {
  for (let version = currentFamilyVersion("select-unit"); version > 1; version -= 1) {
    const extension = familyExtension("select-unit", version);
    if (extension !== undefined && FAMILY_EXTENSIONS_20_SELECT_COUNT_POOL_AND_PAIRING.includes(extension)) return version - 1;
  }
  throw new Error("The extension does not extend select-unit.");
}

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
    expect(() => normalizeFingerprintParameters("select-unit", { distance: "any", visible: false, within_of: "anchor" }, previousSelectUnit())).toThrow(/distance within/u);
    expect(() => normalizeFingerprintParameters("select-unit", { distance: "within", inches: 8, visible: false, within_of: "Anchor Model" }, currentFamilyVersion("select-unit"))).toThrow(/lowercase selection name/u);
  });
});

describe("Round 5C bound selection: an inner select with no distance of its own", () => {
  const version = () => currentFamilyVersion("select-unit");

  it("normalizes within_of with distance any, and still rejects inches there", () => {
    const leaf = { distance: "any", visible: false, within_of: "outer", bind_as: "inner" };
    expect(normalizeFingerprintParameters("select-unit", leaf, version())).toEqual(leaf);
    expect(() => normalizeFingerprintParameters("select-unit", { ...leaf, inches: 6 }, version())).toThrow();
    expect(() => normalizeFingerprintParameters("select-unit", { distance: "any", within_of: "outer" }, version())).toThrow();
  });

  it("keeps accepting every shape the previous version accepted", () => {
    for (const leaf of [
      { distance: "within", inches: 6, visible: false, within_of: "outer" },
      { distance: "any", visible: false, bind_as: "anchor" },
      { distance: "any", visible: true, visible_to: "anchor" },
      { distance: "within", inches: 3, visible: false },
    ]) expect(normalizeFingerprintParameters("select-unit", leaf, version())).toEqual(leaf);
  });

  it("rejects a within_of that is not a selection name, at either distance", () => {
    expect(() => normalizeFingerprintParameters("select-unit", { distance: "any", visible: false, within_of: "Bad Name" }, version())).toThrow(/lowercase selection name/u);
    expect(() => normalizeFingerprintParameters("select-unit", { distance: "within", inches: 6, visible: false, within_of: "Bad Name" }, version())).toThrow(/lowercase selection name/u);
  });

  const text = "Select one friendly ALPHA unit. Select one friendly CARRIER unit that unit is wholly within 6 inches of and is able to embark within. That unit can embark within that CARRIER.";
  const head: Item[] = [
    ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "outer" }],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["Select one friendly", "select-unit", { distance: "any", visible: false, within_of: "outer", bind_as: "inner" }],
    ["CARRIER unit", "unit-filter", { side: "friendly", keywords: ["CARRIER"] }],
  ];
  const candidates: Item[] = [
    ["that unit is wholly within 6 inches of", "unit-position", { kind: "within", inches: 6, wholly: true, subject: "this-unit", of: "antecedent", negated: false }],
    ["and is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }],
  ];
  const permission: Item = ["That unit can embark within that CARRIER", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true, into: "selection" }];

  it("compiles the pair with the 6 inches on the candidate and none on the select", () => {
    const result = resultOf([...head, ...candidates, permission], text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [, inner] = selectorsOf(result.mechanics.effect);
    expect(inner.within_inches_from).toBeUndefined();
    expect(inner.within_inches).toBeUndefined();
    const eligibility = JSON.stringify(inner.eligibility);
    expect(eligibility).toContain('"selection_var":"outer"');
    expect(eligibility).toContain('"inches":6');
    expect(eligibility).toContain('"wholly":true');
    expect(JSON.stringify(result.mechanics.effect)).toContain('"into":{"selection_var":"inner"}');
  });

  it("refuses the pair when no candidate leaf carries the relation", () => {
    const result = resultOf([...head, permission], text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("needs a unit-position or eligible leaf naming that selection");
  });

  it("does not fire the guard for an inner select that measures its own distance", () => {
    const result = resultOf(PAIR);
    expect(result.ok).toBe(true);
  });

  it("refuses within_of together with a transport origin", () => {
    const origin: Item = ["Select one friendly", "select-unit", { distance: "any", visible: false, within_of: "outer", bind_as: "inner", within_origin: "bearer-transport" }];
    expect(() => resultOf([head[0]!, head[1]!, origin, head[3]!, ...candidates, permission], text)).toThrow(/needs a within distance/u);
  });
});
