import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/families/index.js";

/** The family versions the extensions under test create. */
const RESOURCE_SPEND_GAIN_QUALIFIERS_VERSIONS: ReadonlySet<string> = new Set(["event@27"]);

type Item = [string, string, Record<string, unknown>, string?];

/** Leaves placed by their wording in `text`, in order (fabricated wording, not rules text). */
function compileItems(text: string, items: Item[], abilityId?: string) {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  const leaves: CompileLeaf[] = items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
  return compileLeaves(leaves, text, { abilityId });
}
function mechanicsOf(text: string, items: Item[]): Record<string, any> {
  const result = compileItems(text, items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}
const errorsOf = (text: string, items: Item[]): string[] => {
  const result = compileItems(text, items);
  return result.ok ? [] : result.errors;
};

/** The version just before this extension of event. */
const PREVIOUS_EVENT = (() => {
  for (let version = currentFamilyVersion("event"); version > 1; version -= 1) {
    const extension = familyExtension("event", version);
    if (extension !== undefined && RESOURCE_SPEND_GAIN_QUALIFIERS_VERSIONS.has(`${extension.family}@${extension.version}`)) return version - 1;
  }
  throw new Error("The qualifier extension does not extend event.");
})();

const POOL = { kind: "resource-spent", pool: "ember-pool" };
const roll: Item[] = [
  ["roll one D6", "dice-roll", { dice: "D6" }],
  ["on a 5+", "roll-result", { from: 5 }],
  ["you gain 1 ember", "resource-gain", { pool: "ember-pool", amount: 1 }],
];

describe("event resource-spent purpose keys (normalizer)", () => {
  const now = currentFamilyVersion("event");
  it("accepts activity, tag and object on a resource-spent now and not at the version before", () => {
    for (const leaf of [{ ...POOL, activity: "manoeuvre" }, { ...POOL, tag: "empowered" }, { ...POOL, object: "this-unit" }, { ...POOL, tag: "empowered", object: "antecedent" }, { ...POOL, activity: "ritual", object: "this-unit" }]) {
      expect(normalizeFingerprintParameters("event", leaf, now)).toEqual(leaf);
      expect(() => normalizeFingerprintParameters("event", leaf, PREVIOUS_EVENT)).toThrow();
    }
  });
  it("keeps every leaf the previous version accepted", () => {
    for (const leaf of [POOL, { kind: "resource-gained", pool: "ember-pool" }, { kind: "used", activity: "ability" }, { kind: "designation-changed", tag: "empowered" }, { kind: "targets-selected", object: "antecedent" }, { kind: "damage-allocated", object: "this-model" }, { kind: "unit-destroyed", by: "this-unit" }]) {
      expect(normalizeFingerprintParameters("event", leaf, PREVIOUS_EVENT)).toEqual(leaf);
      expect(normalizeFingerprintParameters("event", leaf, now)).toEqual(leaf);
    }
  });
  it("refuses activity with tag, an unregistered tag, a list-building tag, a bad object, and the keys on a kind that does not take them", () => {
    expect(() => normalizeFingerprintParameters("event", { ...POOL, activity: "manoeuvre", tag: "empowered" }, now)).toThrow(/not both/);
    expect(() => normalizeFingerprintParameters("event", { ...POOL, tag: "not-a-designation" }, now)).toThrow(/registered designation/);
    expect(() => normalizeFingerprintParameters("event", { ...POOL, tag: "warlord" }, now)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { ...POOL, activity: "teleport" }, now)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { ...POOL, object: "this-model" }, now)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "resource-gained", pool: "ember-pool", tag: "empowered" }, now)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "unit-destroyed", activity: "manoeuvre" }, now)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { ...POOL, extra: 1 }, now)).toThrow();
  });
});

describe("a spend named by its purpose compiles to the trigger's filter and object", () => {
  it("lowers an Empower spend with the empowered unit's range after it (the object range, no owner)", () => {
    const text = "Each time you spend 1 ember to Empower a friendly unit within 9\" of this unit, roll one D6: on a 5+, you gain 1 ember.";
    const items: Item[] = [
      ["Each time you spend 1 ember to Empower", "event", { ...POOL, tag: "empowered" }],
      ["a friendly unit", "unit-filter", { side: "friendly" }],
      ["within 9\" of this unit", "aura-range", { inches: 9, of: "this-unit" }],
      ...roll,
    ];
    const trigger = mechanicsOf(text, items).trigger;
    expect(trigger).toEqual({ event: "resource-spent", filter: { pool: "ember-pool", tag: "empowered" }, object: { owner: "friendly", within: { of: "this-unit", range: { inches: 9 } } } });
  });
  it("drops the purpose from the trigger only when the leaf drops it", () => {
    const text = "Each time you spend 1 ember to Empower a friendly unit within 9\" of this unit, roll one D6: on a 5+, you gain 1 ember.";
    const items: Item[] = [
      ["Each time you spend 1 ember to Empower", "event", POOL],
      ["a friendly unit", "unit-filter", { side: "friendly" }],
      ["within 9\" of this unit", "aura-range", { inches: 9, of: "this-unit" }],
      ...roll,
    ];
    // A spend with no purpose still lowers (the filter carries only the pool), so the tag is what the leaf supplied.
    expect(errorsOf(text, items)).toEqual([]);
    expect(mechanicsOf(text, items).trigger.filter).toEqual({ pool: "ember-pool" });
  });
  it("folds a range before a spend (the empowered unit is the spend's object)", () => {
    const text = "While a friendly unit is within 9\" of this unit, when you spend 1 ember to Empower that friendly unit, roll one D6: on a 5+, you gain 1 ember.";
    const items: Item[] = [
      ["friendly unit", "unit-filter", { side: "friendly" }],
      ["within 9\" of this unit", "aura-range", { inches: 9, of: "this-unit" }],
      ["when you spend 1 ember to Empower that friendly unit", "event", { ...POOL, tag: "empowered", object: "antecedent" }],
      ...roll,
    ];
    const trigger = mechanicsOf(text, items).trigger;
    expect(trigger).toEqual({ event: "resource-spent", filter: { pool: "ember-pool", tag: "empowered" }, object: { owner: "friendly", within: { of: "this-unit", range: { inches: 9 } } } });
    expect(trigger.owner).toBeUndefined();
  });
  it("lowers a manoeuvre spend for this unit with kind and object", () => {
    const text = "Each time you spend 1 ember to enable this unit to perform a Glide Manoeuvre, roll one D6: on a 5+, you gain 1 ember.";
    const items: Item[] = [["Each time you spend 1 ember to enable this unit to perform a Glide Manoeuvre", "event", { ...POOL, activity: "manoeuvre", object: "this-unit" }], ...roll];
    expect(mechanicsOf(text, items).trigger).toEqual({ event: "resource-spent", filter: { pool: "ember-pool", kind: "manoeuvre" }, object: "this-unit" });
  });
  it("keeps a leading-unit gate beside the manoeuvre spend", () => {
    const text = "While this model is leading a unit, each time you spend 1 ember to enable that unit to perform a Glide Manoeuvre, roll one D6: on a 5+, you gain 1 ember.";
    const items: Item[] = [
      ["While this model is leading a unit", "leading-unit", { subject: "this-model", attachment: "leading" }],
      ["each time you spend 1 ember to enable that unit to perform a Glide Manoeuvre", "event", { ...POOL, activity: "manoeuvre", object: "this-unit" }],
      ...roll,
    ];
    const lowered = mechanicsOf(text, items);
    expect(lowered.trigger.filter).toEqual({ pool: "ember-pool", kind: "manoeuvre" });
    expect(lowered.trigger.object).toBe("this-unit");
    expect(JSON.stringify(lowered)).toContain("leading");
  });
});

describe("a whole Empower record (loadout clause and roll bonus)", () => {
  const tail = (cannon: string): Item[] => [
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["adding 1 to the result", "roll-modifier", { roll: "preceding", operation: "add", value: 1 }],
    [cannon, "named-weapon", { subject: "this-unit", name: "Foo cannon", count: 1, models: { at_least: 1, state: "lack" } }],
    ["on a 5+", "roll-result", { from: 5 }],
    ["you gain 1 ember", "resource-gain", { pool: "ember-pool", amount: 1 }],
  ];
  const object = { owner: "friendly", within: { of: "this-unit", range: { inches: 9 } } };
  it("compiles the spend-then-range form with a D6+1 branch behind the loadout test", () => {
    const text = "Each time you spend 1 ember to Empower a friendly unit within 9\" of this unit, roll one D6, adding 1 to the result if one or more models in this unit are not equipped with a Foo cannon: on a 5+, you gain 1 ember.";
    const lowered = mechanicsOf(text, [
      ["Each time you spend 1 ember to Empower", "event", { ...POOL, tag: "empowered" }],
      ["a friendly unit", "unit-filter", { side: "friendly" }],
      ["within 9\" of this unit", "aura-range", { inches: 9, of: "this-unit" }],
      ...tail("one or more models in this unit are not equipped with a Foo cannon"),
    ]);
    expect(lowered.trigger).toEqual({ event: "resource-spent", filter: { pool: "ember-pool", tag: "empowered" }, object });
    expect(JSON.stringify(lowered.effect)).toContain("D6+1");
  });
  it("compiles the range-then-spend form to the same trigger", () => {
    const text = "While a friendly unit is within 9\" of this unit, when you spend 1 ember to Empower that friendly unit, roll one D6, adding 1 to the result if a model in this unit does not have a Foo cannon: On a 5+, you gain 1 ember.";
    const lowered = mechanicsOf(text, [
      ["friendly unit", "unit-filter", { side: "friendly" }],
      ["within 9\" of this unit", "aura-range", { inches: 9, of: "this-unit" }],
      ["when you spend 1 ember to Empower that friendly unit", "event", { ...POOL, tag: "empowered", object: "antecedent" }],
      ...tail("a model in this unit does not have a Foo cannon").map(([w, ...rest]): Item => [w === "on a 5+" ? "On a 5+" : w, ...rest]),
    ]);
    expect(lowered.trigger).toEqual({ event: "resource-spent", filter: { pool: "ember-pool", tag: "empowered" }, object });
  });
});

describe("refusals", () => {
  it("refuses an antecedent object with no unit-filter and range beside it", () => {
    const text = "Each time you spend 1 ember to Empower that unit, roll one D6: on a 5+, you gain 1 ember.";
    const errors = errorsOf(text, [["Each time you spend 1 ember to Empower that unit", "event", { ...POOL, tag: "empowered", object: "antecedent" }], ...roll]);
    expect(errors.join(" ")).toMatch(/earlier leaf's unit/);
  });
  it("refuses an aura that says wholly within for a spend's unit range", () => {
    const text = "Each time you spend 1 ember to Empower a friendly unit wholly within 9\" of this unit, roll one D6: on a 5+, you gain 1 ember.";
    const errors = errorsOf(text, [
      ["Each time you spend 1 ember to Empower", "event", { ...POOL, tag: "empowered" }],
      ["a friendly unit", "unit-filter", { side: "friendly" }],
      ["wholly within 9\" of this unit", "aura-range", { inches: 9, of: "this-unit", wholly: true }],
      ...roll,
    ]);
    expect(errors.join(" ")).toMatch(/wholly/);
  });
  it("refuses a spend that already names its unit when a filter and range follow", () => {
    const text = "Each time you spend 1 ember to Empower this unit and a friendly unit within 9\" of this unit, roll one D6: on a 5+, you gain 1 ember.";
    const errors = errorsOf(text, [
      ["Each time you spend 1 ember to Empower this unit", "event", { ...POOL, tag: "empowered", object: "this-unit" }],
      ["a friendly unit", "unit-filter", { side: "friendly" }],
      ["within 9\" of this unit", "aura-range", { inches: 9, of: "this-unit" }],
      ...roll,
    ]);
    expect(errors.join(" ")).toMatch(/already names/);
  });
  it("does not fold a designation-less spend into an object range", () => {
    const text = "Each time you spend 1 ember on a friendly unit within 9\" of this unit, roll one D6: on a 5+, you gain 1 ember.";
    const result = compileItems(text, [
      ["Each time you spend 1 ember", "event", POOL],
      ["a friendly unit", "unit-filter", { side: "friendly" }],
      ["within 9\" of this unit", "aura-range", { inches: 9, of: "this-unit" }],
      ...roll,
    ]);
    expect(result.ok).toBe(true);
    // The designation-less spend keeps the plain trigger; the filter and range are not folded into its object.
    if (result.ok) expect((result.mechanics as any).trigger).toEqual({ event: "resource-spent", filter: { pool: "ember-pool" } });
  });
});

describe("a spend through a named rule (ability-used)", () => {
  it("lowers 'you spend using the Foo rule' as a used history check", () => {
    const text = "Each time the bearer's unit is selected to shoot, if you spend 1 ember using the Foo Detachment rule when doing so, you can roll one D6: on a 5+, you gain 1 ember.";
    const items: Item[] = [
      ["Each time the bearer's unit is selected to shoot", "event", { kind: "selected", to: "shoot" }],
      ["you spend 1 ember using the Foo Detachment rule when doing so", "ability-used", { subject: "this-unit", activity: "ability", id: "foo-detachment-rule", window: "now", negated: false }],
      ["you can", "optional-use", { who: "you" }],
      ...roll,
    ];
    const result = compileItems(text, items);
    expect(result.ok).toBe(true);
    expect(JSON.stringify((result as any).mechanics)).toContain("foo-detachment-rule");
  });
});
