import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/families/index.js";
import { claimedByEmbarkedState } from "../src/round5c/compile-embarked-exclusion.js";
import { mergeStackedFilters } from "../src/round5c/compile-unit-filters.js";

/** The family versions the extensions under test create. */
const EMBARKED_UNITS_STATE_SUBJECT_AND_MOVES_VERSIONS: ReadonlySet<string> = new Set(["unit-filter@14", "make-move@6", "eligibility-permission@7", "unit-state@16"]);

// Fabricated wording throughout: "stowed within this Hauler" stands for embarked within this unit.

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, ...(fragment ? { fragment } : {}) };
  });
}

function compiled(text: string, ...items: Item[]) {
  return compileLeaves(placed(text, ...items), text);
}

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compiled(text, ...items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function refusal(text: string, ...items: Item[]): string {
  const result = compiled(text, ...items);
  if (result.ok) throw new Error("compiled, but should refuse");
  return result.errors.join("; ");
}

/** The version at which this extension sits for `family`, found by lookup; later extensions may sit above it. */
const ownVersion = (family: string) => {
  for (let version = currentFamilyVersion(family); version > 1; version -= 1) {
    const extension = familyExtension(family, version);
    if (extension !== undefined && EMBARKED_UNITS_STATE_SUBJECT_AND_MOVES_VERSIONS.has(`${extension.family}@${extension.version}`)) return version;
  }
  throw new Error(`The embarked-units extension does not extend ${family}.`);
};
/** The version this extension replaced: one below its own, never current - 1. */
const previousOf = (family: string) => ownVersion(family) - 1;
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, ownVersion(family));
const normalizePrevious = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, previousOf(family));

const STOWED = { side: "friendly", embarked_in: "this-unit" };

describe("unit-filter embarked_in", () => {
  it("accepts friendly units embarked within this unit or this model", () => {
    expect(normalize("unit-filter", STOWED)).toMatchObject(STOWED);
    expect(normalize("unit-filter", { ...STOWED, embarked_in: "this-model", level: "model", keywords: ["BIG MEK"] })).toMatchObject({ embarked_in: "this-model", level: "model" });
  });

  it("refuses another side, an unknown Transport, and filters that name a different set of units", () => {
    expect(() => normalize("unit-filter", { side: "enemy", embarked_in: "this-unit" })).toThrow(/friendly/);
    expect(() => normalize("unit-filter", { side: "any", embarked_in: "this-unit" })).toThrow(/friendly/);
    expect(() => normalize("unit-filter", { ...STOWED, embarked_in: "target" })).toThrow(/this-unit or this-model/);
    expect(() => normalize("unit-filter", { ...STOWED, held_in: "strategic-reserves" })).toThrow(/held_in/);
    expect(() => normalize("unit-filter", { ...STOWED, alternatives: [{ keywords: ["ALPHA"] }, { keywords: ["BETA"] }] })).toThrow(/alternatives/);
    expect(() => normalize("unit-filter", { ...STOWED, designated: "bondsman-affected" })).toThrow(/designated/);
  });

  it("normalizes every input the previous version accepted to the same value", () => {
    for (const leaf of [{ side: "friendly" }, { side: "enemy", keywords: ["ALPHA"], states: ["engaged"] }, { side: "any", level: "model", excluded_keywords: ["BETA"] }]) {
      expect(normalize("unit-filter", leaf)).toEqual(normalizePrevious("unit-filter", leaf));
    }
  });
});

describe("unit-filter embarked_in in compilation", () => {
  it("preserves embarked membership on selections and auras, but refuses a static Stratagem target", () => {
    const select = "Select one unit stowed within this Hauler. That unit gains Stealth.";
    expect(mechanicsOf(select,
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["unit stowed within this Hauler", "unit-filter", STOWED],
      ["That unit gains Stealth", "core-ability-grant", { subject: "antecedent", ability: "stealth" }]).effect)
      .toMatchObject({ type: "select-units", selector: { filter: { owner: "friendly", embarked_in: "this-unit" } } });
    const aura = "While a unit stowed within this Hauler is within 6\" of this model, it gains Stealth.";
    expect(mechanicsOf(aura,
      ["unit stowed within this Hauler", "unit-filter", STOWED],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["it gains Stealth", "core-ability-grant", { subject: "antecedent", ability: "stealth" }]).effect)
      .toMatchObject({ type: "aura", modifier: { eligible: { owner: "friendly", embarked_in: "this-unit" } } });
    const target = "Movement phase. One unit stowed within this Hauler. That unit gains Stealth.";
    expect(refusal(target,
      ["Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["unit stowed within this Hauler", "unit-filter", STOWED, "TARGET"],
      ["That unit gains Stealth", "core-ability-grant", { subject: "this-unit", ability: "stealth" }, "EFFECT"])).toMatch(/static Stratagem TARGET metadata/u);
  });

  it("refuses alternatives that name units embarked within a unit", () => {
    const text = "Friendly ALPHA units stowed within this Hauler or BETA units stowed within this Hauler can move.";
    expect(refusal(text,
      ["ALPHA units stowed within this Hauler", "unit-filter", { ...STOWED, keywords: ["ALPHA"] }],
      ["BETA units stowed within this Hauler", "unit-filter", { ...STOWED, keywords: ["BETA"] }],
      ["can move", "make-move", { subject: "filtered-units", move_type: "normal" }])).toMatch(/Alternative unit-filters.*units embarked within a unit/);
  });
});

describe("make-move subject filtered-units and mode", () => {
  const TEXT = "In your Movement phase, when this unit ends a normal move, units stowed within this Hauler can make a swift hop move.";
  const base = (move: Record<string, unknown>): Item[] => [
    ["In your Movement phase", "phase-window", { phase: "movement", turn: "your" }],
    ["when this unit ends a normal move", "event", { kind: "move-ended", move_types: ["normal"] }],
    ["units stowed within this Hauler", "unit-filter", STOWED],
    ["can make a swift hop move", "make-move", move],
  ];

  it("compiles to a disembark move of the units embarked within this unit, with its mode", () => {
    const mech = mechanicsOf(TEXT, ...base({ subject: "filtered-units", move_type: "disembark", mode: "assault" }));
    expect(mech.trigger).toEqual({ event: "move-ended", filter: { move_types: ["normal"] } });
    expect(mech.effect.effect).toEqual({ type: "move", target: { owner: "friendly", embarked_in: "this-unit" }, modifier: { move_type: "disembark", mode: "assault" } });
  });

  it("omits the mode when none is given", () => {
    const mech = mechanicsOf(TEXT, ...base({ subject: "filtered-units", move_type: "disembark" }));
    expect(mech.effect.effect.modifier).toEqual({ move_type: "disembark" });
  });

  it("refuses a mode on a move that is not a disembark, and an unknown mode", () => {
    expect(() => normalize("make-move", { subject: "this-unit", move_type: "normal", mode: "assault" })).toThrow(/disembark/);
    expect(() => normalize("make-move", { subject: "filtered-units", move_type: "disembark", mode: "shock" })).toThrow(/mode is one of/);
    expect(() => normalize("make-move", { subject: "filtered-units", move_type: "disembark", mode: "swift" })).toThrow(/mode is one of/);
  });

  it("refuses filtered-units with no unit-filter before the move", () => {
    expect(refusal("When this unit ends a normal move, it can make a swift hop move.",
      ["When this unit ends a normal move", "event", { kind: "move-ended", move_types: ["normal"] }],
      ["it can make a swift hop move", "make-move", { subject: "filtered-units", move_type: "disembark" }])).toMatch(/names the units of a unit-filter, but none sits right before it/);
  });

  it("normalizes every input the previous version accepted to the same value", () => {
    for (const leaf of [{ subject: "this-unit", move_type: "normal" }, { subject: "selected-unit", move_type: "advance", distance: 3 }, { subject: "event-subject", move_type: "disembark" }]) {
      expect(normalize("make-move", leaf)).toEqual(normalizePrevious("make-move", leaf));
    }
    expect(normalize("make-move", { subject: "this-unit", move_type: "disembark", mode: "combat" })).toMatchObject({ mode: "combat" });
  });
});

describe("eligibility-permission subject filtered-units", () => {
  const TEXT = "While this Hauler carries units, units cannot embark within this unit.";
  it("denies embarking into this unit for the units a filter names", () => {
    const mech = mechanicsOf(TEXT,
      ["While this Hauler carries units", "unit-state", { states: ["carrying-units"], subject: "this-unit", negated: true }],
      ["units", "unit-filter", { side: "friendly" }],
      ["cannot embark within this unit", "eligibility-permission", { subject: "filtered-units", activity: "embark", allow: false, into: "this-unit" }]);
    expect(mech.effect.effect).toMatchObject({ type: "permission", target: { owner: "friendly" } });
    expect(JSON.stringify(mech.effect)).toContain('"into":"this-unit"');
  });

  it("normalizes every input the previous version accepted to the same value", () => {
    for (const leaf of [{ subject: "this-unit", activity: "embark", allow: false, into: "this-unit" }, { subject: "event-subject", activity: "embark", allow: true }]) {
      expect(normalize("eligibility-permission", leaf)).toEqual(normalizePrevious("eligibility-permission", leaf));
    }
    expect(normalize("eligibility-permission", { subject: "filtered-units", activity: "embark", allow: false, into: "this-unit" })).toMatchObject({ subject: "filtered-units" });
  });
});

describe("unit-state embarked within a named Transport", () => {
  const BIG_MEK = "While a Big Mek model is stowed within this Hauler, add 1 to the Hit roll for this unit.";
  const bigMek = (state: Record<string, unknown>, filter: Record<string, unknown> = { side: "friendly", level: "model", keywords: ["BIG MEK"] }): Item[] => [
    ["a Big Mek model", "unit-filter", filter],
    ["is stowed within this Hauler", "unit-state", { states: ["embarked"], subject: "antecedent", negated: false, with: "this-unit", ...state }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
  ];

  it("normalizes: accepts a Transport for the units a filter names; refuses what it cannot say", () => {
    const ok = { states: ["embarked"], subject: "antecedent", negated: false, with: "this-unit" };
    expect(normalize("unit-state", ok)).toEqual(ok);
    expect(normalize("unit-state", { ...ok, with: "this-model", negated: true })).toMatchObject({ with: "this-model", negated: true });
    expect(() => normalize("unit-state", { ...ok, at: "phase-start" })).toThrow(/no earlier point/);
    expect(() => normalize("unit-state", { ...ok, with: "target" })).toThrow(/this-unit or this-model/);
    expect(() => normalize("unit-state", { ...ok, with: "antecedent" })).toThrow(/this-unit or this-model/);
    expect(() => normalize("unit-state", { ...ok, subject: "this-unit" })).toThrow(/takes no with/);
    expect(() => normalize("unit-state", { ...ok, subject: "this-model" })).toThrow(/takes no with/);
    expect(() => normalize("unit-state", { ...ok, states: ["embarked", "engaged"] })).toThrow();
  });

  it("normalizes every input the previous version accepted to the same value", () => {
    const old: Array<Record<string, unknown>> = [
      { states: ["embarked"], subject: "this-unit", negated: false },
      { states: ["embarked"], subject: "this-model", negated: true },
      { states: ["embarked"], subject: "target", negated: false },
      { states: ["embarked"], subject: "each-target", negated: false },
      { states: ["engaged"], subject: "this-model", negated: false },
      { states: ["engaged"], subject: "this-unit", negated: false, with: "following-filter" },
      { states: ["hidden"], subject: "this-unit", negated: false },
      { states: ["battle-shocked"], subject: "this-unit", negated: false, at: "phase-start" },
    ];
    for (const leaf of old) expect(normalize("unit-state", leaf)).toEqual(normalizePrevious("unit-state", leaf));
    // The old refusals stay: embarked with a Transport for a subject the new form does not name.
    expect(() => normalize("unit-state", { states: ["embarked"], subject: "target", negated: false, with: "this-unit" })).toThrow();
  });

  it("compiles to a state of the filter's own units embarked within this unit", () => {
    const mech = mechanicsOf(BIG_MEK, ...bigMek({}));
    expect(mech.effect.condition).toEqual({ type: "matches", parameters: { subject: { owner: "friendly", all_of: ["BIG MEK"], level: "model", embarked_in: "this-unit" }, filter: { state: "embarked" } } });
  });

  it("reads a negated state as no such unit embarked, and this-model as the model's own Transport", () => {
    const mech = mechanicsOf(BIG_MEK, ...bigMek({ negated: true, with: "this-model" }));
    expect(mech.effect.condition).toEqual({ operator: "not", operands: [{ type: "matches", parameters: { subject: { owner: "friendly", all_of: ["BIG MEK"], level: "model", embarked_in: "this-model" }, filter: { state: "embarked" } } }] });
  });

  it("still compiles the plain embarked state (no Transport) unchanged", () => {
    const mech = mechanicsOf(BIG_MEK, ["is stowed within this Hauler", "unit-state", { states: ["embarked"], subject: "this-unit", negated: false }], ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(mech.effect.condition).toEqual({ type: "matches", parameters: { filter: { state: "embarked" } } });
  });

  it("refuses a named Transport for a unit that is not a filter's (a selected unit)", () => {
    const text = "Select one friendly unit. If that unit is stowed within this Hauler, add 1 to the Hit roll for that unit.";
    expect(refusal(text,
      ["Select one friendly unit", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      ["that unit is stowed within this Hauler", "unit-state", { states: ["embarked"], subject: "selected-unit", negated: false, with: "this-unit" }] as Item,
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])).toMatch(/DSL_GAP: a named unit embarked within a named Transport/);
  });
});

describe("a trigger's subject is the units embarked within this unit", () => {
  const TEXT = "Each time a unit stowed within this Hauler is selected to make a hop move, it gains the riled-up mark.";
  it("names the embarked units as the trigger's subject filter", () => {
    const mech = mechanicsOf(TEXT,
      ["a unit stowed within this Hauler", "unit-filter", STOWED],
      ["is selected to make a hop move", "event", { kind: "selected", move_types: ["disembark"], to: "move" }],
      ["it gains the riled-up mark", "apply-mark", { subject: "antecedent", tag: "riled-up" }]);
    expect(mech.trigger).toMatchObject({ event: "selected", subject: { owner: "friendly", embarked_in: "this-unit" } });
  });
});

describe("a Transport target and the unit embarked within it", () => {
  const TEXT = "Movement phase. One friendly ALPHA TRANSPORT unit that has a ALPHA BATTLELINE unit stowed within it. Add 1 to the Hit roll for that unit.";
  const items = (tail: Array<Item>): Item[] => [
    ["Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["friendly ALPHA TRANSPORT unit", "unit-filter", { side: "friendly", keywords: ["ALPHA", "TRANSPORT"] }, "TARGET"],
    ["ALPHA BATTLELINE unit", "unit-filter", { side: "friendly", keywords: ["ALPHA", "BATTLELINE"] }, "TARGET"],
    ...tail,
    ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }, "EFFECT"],
  ];
  const STATE: Item = ["stowed within it", "unit-state", { states: ["embarked"], subject: "antecedent", negated: false, with: "this-unit" }, "TARGET"];

  it("keeps the Transport's keywords apart from the carried unit's and states the carried unit in the eligibility", () => {
    const result = compileLeaves(placed(TEXT, ...items([STATE])), TEXT);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.core?.target_restrictions).toMatchObject({
      required_keywords: ["ALPHA", "TRANSPORT"],
      eligibility: { type: "matches", parameters: { subject: { owner: "friendly", all_of: ["ALPHA", "BATTLELINE"], embarked_in: "this-unit" }, filter: { state: "embarked" } } },
    });
  });

  it("still merges two stacked filters that no embarked state follows", () => {
    const result = compileLeaves(placed(TEXT, ...items([])), TEXT);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.core?.target_restrictions?.required_keywords).toEqual(["ALPHA", "BATTLELINE", "TRANSPORT"]);
  });

  it("keeps the filters apart under both spellings of the state's subject (before and after antecedent binding)", () => {
    const filter = (keywords: string[]) => placed("x", ["x", "unit-filter", { side: "friendly", keywords }, "TARGET"])[0]!;
    const state = (subject: string) => placed("x", ["x", "unit-state", { states: ["embarked"], subject, negated: false, with: "this-unit" }, "TARGET"])[0]!;
    for (const subject of ["antecedent", "filtered-units"]) {
      const list = [filter(["ALPHA", "TRANSPORT"]), filter(["ALPHA", "BATTLELINE"]), state(subject)];
      expect(mergeStackedFilters(list)).toHaveLength(3);
      expect(claimedByEmbarkedState(list, 1, "TARGET")).toBe(true);
    }
    expect(mergeStackedFilters([filter(["ALPHA", "TRANSPORT"]), filter(["ALPHA", "BATTLELINE"])])).toHaveLength(1);
    // A different state, a state with no Transport and a state about another subject do not claim the filter.
    for (const parameters of [{ states: ["engaged"], subject: "antecedent", negated: false }, { states: ["embarked"], subject: "antecedent", negated: false }, { states: ["embarked"], subject: "this-unit", negated: false, with: "this-unit" }]) {
      const other = placed("x", ["x", "unit-state", parameters, "TARGET"])[0]!;
      expect(claimedByEmbarkedState([filter(["A"]), filter(["B"]), other], 1, "TARGET")).toBe(false);
    }
  });

  it("narrows the carried units by an exclusion that trails the state", () => {
    const text = TEXT.replace(" Add 1", " (excluding Battle-shocked units). Add 1");
    const result = compileLeaves(placed(text, ...items([STATE, ["(excluding Battle-shocked units)", "unit-filter", { side: "friendly", states: ["not-battle-shocked"] }, "TARGET"]])), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.core?.target_restrictions?.eligibility).toEqual({ type: "matches", parameters: { subject: { owner: "friendly", all_of: ["ALPHA", "BATTLELINE"], not_states: ["battle-shocked"], embarked_in: "this-unit" }, filter: { state: "embarked" } } });
    expect(result.core?.target_restrictions?.required_keywords).toEqual(["ALPHA", "TRANSPORT"]);
  });

  it("refuses a trailing filter that requires anything: it has no shape", () => {
    const text = TEXT.replace(" Add 1", " (BETA units). Add 1");
    const message = refusal(text, ...items([STATE, ["(BETA units)", "unit-filter", { side: "friendly", keywords: ["BETA"] }, "TARGET"]]));
    expect(message).toMatch(/can only exclude/);
    expect(message).not.toMatch(/needs a select-unit or attack/);
  });
});

describe("units embarked within this model", () => {
  const TEXT = "While one or more ALPHA units are stowed within this model, add 1 to the Hit roll for this model.";
  const gate = (negated: boolean) => mechanicsOf(TEXT,
    ["one or more ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"], embarked_in: "this-model" }],
    ["are stowed within this model", "unit-state", { states: ["embarked"], subject: "antecedent", negated, with: "this-model" }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]).effect.condition;

  it("names the model as the Transport on both the filter and the state's subject", () => {
    expect(gate(false)).toEqual({ type: "matches", parameters: { subject: { owner: "friendly", all_of: ["ALPHA"], embarked_in: "this-model" }, filter: { state: "embarked" } } });
  });

  it("refuses a filter and a state that name different Transports", () => {
    expect(refusal(TEXT,
      ["one or more ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"], embarked_in: "this-unit" }],
      ["are stowed within this model", "unit-state", { states: ["embarked"], subject: "antecedent", negated: false, with: "this-model" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])).toMatch(/different Transports/);
  });
});
