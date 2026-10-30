import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order. */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

/** Every node of `type` in an effect tree, depth-first. */
function nodes(node: unknown, type: string): Record<string, any>[] {
  if (Array.isArray(node)) return node.flatMap((inner) => nodes(inner, type));
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, any>;
  return [...(record.type === type ? [record] : []), ...Object.values(record).flatMap((inner) => nodes(inner, type))];
}

const TEXT = "At the end of your Command phase, for each **BEACON** unit from your army, you can select one friendly **ALPHA** unit and one friendly **BETA** unit each within 9\" of and visible to that Beacon unit. If you do, that **ALPHA** unit suffers D3+1 mortal wounds and one model in the selected **BETA** unit regains up to that many lost wounds.";

const opening: Item[] = [
  ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
  ["for each", "for-each-unit-select", {}],
  ["**BEACON** unit", "unit-filter", { side: "friendly", keywords: ["BEACON"] }],
  ["from your army", "unit-owner", { owner: "friendly" }],
  ["you can", "optional-use", { who: "you" }],
  ["select one", "select-unit", { scope: "friendly", distance: "any", visible: false, bind_as: "alpha" }],
  ["friendly **ALPHA** unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
  ["one", "select-unit", { scope: "friendly", distance: "any", visible: false, bind_as: "beta" }],
  ["friendly **BETA** unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }],
];
const near = (wording = "each within 9\" of"): Item[] => [
  [wording, "unit-position", { kind: "within", inches: 9, of: "recipient", subject: "selected-unit", negated: false }],
  ["visible to that Beacon unit", "visible", { subject: "selected-unit", to: "recipient" }],
];
const wounds = (selection = "alpha"): Item => ["that **ALPHA** unit suffers D3+1 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3+1", selection }];
const regain = (amount = "that-many"): Item => ["one model in the selected **BETA** unit regains up to that many lost wounds", "regain-wounds", { subject: "antecedent", amount, selection: "beta" }];

function compiled(items: Item[], text = TEXT) {
  return compileLeaves(placed(text, ...items), text, {});
}

const ALL = (): Item[] => [...opening, ...near(), wounds(), regain()];

describe("two selections bound apart, named one by one, once per pass of a loop", () => {
  it("offers the selections in each pass, nests them in printed order, and gives each effect its own unit", () => {
    const result = compiled(ALL());
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as any;
    // The choice is each pass's, not the moment's; "from your army" is the loop filter's own side, not a gate.
    expect(mechanics.trigger.optional).toBeUndefined();
    expect(mechanics.effect).toMatchObject({ type: "for-each-unit", selector: { filter: { owner: "friendly", all_of: ["BEACON"] } }, effect: { type: "ability-part", optional: true } });
    const [outer, inner] = nodes(mechanics.effect, "select-units");
    expect(outer!.selector).toMatchObject({ filter: { all_of: ["ALPHA"] }, bind_as: "alpha" });
    expect(inner!.selector).toMatchObject({ filter: { all_of: ["BETA"] }, bind_as: "beta" });
    expect(outer!.effect).toBe(inner);
    // "each within 9\" of and visible to": both conditions gate both selections, measured from the pass's unit.
    const gates = { operator: "and", operands: [
      { type: "matches", parameters: { subject: "selected-unit", filter: { within: { of: "recipient", range: { inches: 9 } } } } },
      { type: "matches", parameters: { subject: "selected-unit", filter: { visible: { to: "recipient" } } } },
    ] };
    expect(outer!.selector.eligibility).toEqual(gates);
    expect(inner!.selector.eligibility).toEqual(gates);
    // One roll for the mortal wounds and the wounds regained.
    expect(inner!.effect).toEqual({ type: "roll", dice: "D3+1", roll_var: "that-many", effect: { type: "sequence", steps: [
      { type: "mortal-wounds", target: { selection_var: "alpha" }, modifier: { count: { roll_var: "that-many" } } },
      { type: "heal", target: { selection_var: "beta" }, modifier: { amount: { roll_var: "that-many" } } },
    ] } });
    expect(describeAbility({ id: "sample", name: "Sample", ...mechanics })).toContain("equal to the result of that roll");
  });

  it("gates only the nearest selection with a condition that does not open with each", () => {
    const result = compiled([...opening, ...near("within 9\" of"), wounds(), regain()], TEXT.replace("each within", "within"));
    if (!result.ok) throw new Error(result.errors.join("; "));
    const [outer, inner] = nodes(result.mechanics, "select-units");
    expect(outer!.selector.eligibility).toBeUndefined();
    expect(inner!.selector.eligibility.operands).toHaveLength(2);
  });

  it("refuses an effect that names a selected unit without saying which", () => {
    const { selection: _selection, ...bare } = wounds()[2];
    const result = compiled([...opening, ...near(), [wounds()[0], "mortal-wounds", bare], regain()]);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/selects several; its leaf must say which/u);
  });

  it("refuses a name no selection binds", () => {
    const result = compiled([...opening, ...near(), wounds("gamma"), regain()]);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/names the selection "gamma", which this ability does not bind/u);
  });

  it("refuses two selections that bind one name", () => {
    const items = ALL();
    items[7] = ["one", "select-unit", { scope: "friendly", distance: "any", visible: false, bind_as: "alpha" }];
    const result = compiled(items);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/Two selections bind the same name/u);
  });

  it("keeps refusing a loop and a chain whose conditions never read the pass's unit", () => {
    const result = compiled([...opening, ["each within 9\" of", "unit-position", { kind: "within", inches: 9, of: "this-unit", subject: "selected-unit", negated: false }],
      ["visible to that Beacon unit", "visible", { subject: "selected-unit", to: "this-unit" }], wounds(), regain()]);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/loops with for-each-unit-select/u);
  });
});

describe("regain-wounds that-many", () => {
  it("takes a fixed count as that number", () => {
    const text = TEXT.replace("D3+1 mortal wounds", "2 mortal wounds");
    const result = compiled([...opening, ...near(), ["that **ALPHA** unit suffers 2 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "2", selection: "alpha" }], regain()], text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(nodes(result.mechanics, "roll")).toEqual([]);
    expect(nodes(result.mechanics, "heal")[0]!.modifier).toEqual({ amount: 2 });
  });

  it("refuses with no mortal wounds before it in its sentence", () => {
    const text = TEXT.replace("D3+1 mortal wounds and", "D3+1 mortal wounds. Then");
    const result = compiled([...opening, ...near(), wounds(), regain()], text);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/needs the mortal wounds it counts before it in its sentence/u);
  });

  it("names which selected unit with selection, and only with its back-reference", () => {
    const version = currentFamilyVersion("regain-wounds");
    expect(normalizeFingerprintParameters("regain-wounds", { subject: "antecedent", amount: "that-many", selection: "beta" }, version)).toEqual({ subject: "antecedent", amount: "that-many", selection: "beta" });
    expect(() => normalizeFingerprintParameters("regain-wounds", { subject: "this-unit", amount: "1", selection: "beta" }, version)).toThrow(/takes no other subject/u);
    expect(() => normalizeFingerprintParameters("mortal-wounds", { recipient: "that-unit", count: "1", selection: "Beta" }, currentFamilyVersion("mortal-wounds"))).toThrow(/lowercase selection name/u);
  });
});

describe("a standing grant on its own line after a moment's effects", () => {
  const body = "**Spark** (**Aura**): While an enemy unit is within 6\" of this unit, each time a friendly **ALPHA** unit makes an attack that targets that enemy unit, add 1 to the Hit roll.";
  // The moment's own sentence has no effect, so it is the record's header (compile-segments.ts).
  const text = (joint: string) => `At the end of your Command phase, select one friendly **ALPHA** unit. That unit suffers 1 mortal wound.${joint}**BETA** units from your army have the following ability:\n${body}`;
  const items: Item[] = [
    ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
    ["select one", "select-unit", { scope: "friendly", distance: "any", visible: false }],
    ["friendly **ALPHA** unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
    ["**BETA** units", "unit-filter", { side: "friendly", keywords: ["BETA"] }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["have the following ability", "ability-record-grant", { subject: "antecedent", printed: "one" }],
    ["Spark** (**Aura", "granted-ability-name", { label: "Spark" }],
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
    ["friendly **ALPHA** unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["makes an attack that targets that enemy unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
  ];
  const grantPlace = (joint: string) => {
    const source = text(joint);
    const result = compileLeaves(placed(source, ...items), source, {});
    if (!result.ok) throw new Error(result.errors.join("; "));
    // Where the grant sits: under the moment (the record's trigger, or a part's), or beside it.
    const mechanics = result.mechanics as any;
    const parts = nodes(mechanics, "ability-part").filter((part) => part.trigger !== undefined);
    const underMoment = mechanics.trigger ? nodes(mechanics.effect, "ability-grant").length > 0 : parts.some((part) => nodes(part.effect, "ability-grant").length > 0);
    return { underMoment, grants: nodes(mechanics, "ability-grant").length };
  };

  it("is held whenever the record applies, not granted at the moment", () => {
    const placedGrant = grantPlace("\n");
    expect(placedGrant.grants).toBe(1);
    expect(placedGrant.underMoment).toBe(false);
  });

  it("stays the moment's when it continues the moment's line", () => {
    expect(grantPlace(" ").underMoment).toBe(true);
  });
});
