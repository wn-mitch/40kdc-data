import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { resolveUnitNames } from "../src/semantic-authoring/compile-unit-names.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

/**
 * A printed result table under an attack-property scope ("attacks have the matching rule:\n1‑2\n+1 A\n…"),
 * its rows split by line breaks alone, and a dice-count option ("roll either one D6 or two D6") whose
 * second count carries a rider of its own. Fabricated wording and names only.
 */

type Item = [wording: string, family: string, parameters: Record<string, unknown>];
type Node = Record<string, any>;

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

function effectOf(text: string, items: Item[]): Node {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Node;
}

function errorsOf(text: string, items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join(" ");
}

const HEAD = "When a friendly Gizmo unit is selected to shoot, you can use this ability. If you do, roll ";
const TABLE = " This unit's attacks have the matching rule:\nGizmo Table\nD6\nResult\n1‑2\n+1 A\n3‑4\n+2 S\n5‑6\n+1 AP";
const RIDER = "\nIf you rolled two D6, when this unit has shot, this unit makes one hazard roll.";

const trigger: Item[] = [
  ["friendly Gizmo unit", "unit-filter", { side: "friendly", keywords: ["GIZMO"] }],
  ["selected to shoot", "event", { kind: "selected", to: "shoot" }],
  ["you can use this ability", "optional-use", { who: "you" }],
];
const rows: Item[] = [
  ["This unit's attacks have", "weapon-property-scope", { subject: "event-subject", weapon_type: "all" }],
  ["1‑2", "roll-result", { from: 1, to: 2 }],
  ["+1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
  ["3‑4", "roll-result", { from: 3, to: 4 }],
  ["+2 S", "characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 2 }],
  ["5‑6", "roll-result", { from: 5, to: 6 }],
  ["+1 AP", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1 }],
];
const rider: Item[] = [
  ["If you rolled two D6", "dice-count-rolled", { count: 2 }],
  ["when this unit has shot", "event", { kind: "attacks-resolved", action_kind: "attack", subject: "event-subject" }],
  ["this unit makes one hazard roll", "test", { target: "event-subject", test: "hazard" }],
];

/** The record's one choice node. */
function choiceOf(mechanics: Node): Node {
  const found: Node[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object") { if ((node as Node).type === "choice") found.push(node as Node); Object.values(node).forEach(walk); }
  };
  walk(mechanics.effect);
  expect(found).toHaveLength(1);
  return found[0]!;
}

/** The A/S/AP outcomes of a compiled table, in face order. */
const statsOf = (table: Node) => table.outcomes.map((outcome: Node) => [outcome.results, outcome.effect.modifier.stat, outcome.effect.target]);
const ROWS = [[[1, 2], "A", "event-subject"], [[3, 4], "S", "event-subject"], [[5, 6], "AP", "event-subject"]];

describe("a result table under an attack-property scope", () => {
  it("binds each row's stat to the scope and gates it by its own band, with rows split only by line breaks", () => {
    const text = `${HEAD}one D6.${TABLE}`;
    const mechanics = effectOf(text, [...trigger, ["one D6", "dice-roll", { dice: "D6" }], ...rows]);
    expect(mechanics.effect.type).toBe("dice-table");
    expect(statsOf(mechanics.effect)).toEqual(ROWS);
  });

  it("ends the last row at its line, so a condition on the next line does not gate that row", () => {
    const text = `${HEAD}either one D6 or two D6 (keep re-rolling duplicate results).${TABLE}${RIDER}`;
    const items: Item[] = [...trigger, ["either one D6", "dice-roll", { dice: "D6" }],
      ["or two D6 (keep re-rolling duplicate results", "dice-count-option", { count: 2, distinct: true }], ...rows, ...rider];
    const [one, two] = choiceOf(effectOf(text, items)).options as Node[];
    expect(one.outcomes.every((outcome: Node) => outcome.effect.type === "stat-modifier")).toBe(true);
    expect(two.steps[0].outcomes.every((outcome: Node) => outcome.effect.type === "stat-modifier")).toBe(true);
  });
});

describe("a dice-count option", () => {
  const text = `${HEAD}either one D6 or two D6 (keep re-rolling duplicate results).${TABLE}${RIDER}`;
  const items: Item[] = [...trigger, ["either one D6", "dice-roll", { dice: "D6" }],
    ["or two D6 (keep re-rolling duplicate results", "dice-count-option", { count: 2, distinct: true }], ...rows, ...rider];

  it("offers the table once or as two distinct dice, and the rider belongs to the two-dice option only", () => {
    const mechanics = effectOf(text, items);
    // The rider's own moment makes the record a part on the selection moment, holding the choice.
    expect(mechanics.effect).toMatchObject({ type: "ability-part", trigger: { event: "selected", optional: true } });
    const choice = mechanics.effect.effect;
    expect(choice).toBe(choiceOf(mechanics));
    const [one, two] = choice.options as Node[];
    expect(one.type).toBe("dice-table");
    expect(one.count).toBeUndefined();
    expect(statsOf(one)).toEqual(ROWS);
    expect(two.type).toBe("sequence");
    expect(two.steps[0]).toMatchObject({ type: "dice-table", count: 2, distinct: true });
    expect(statsOf(two.steps[0])).toEqual(ROWS);
    expect(two.steps[1]).toEqual({ type: "ability-part", trigger: { event: "attacks-resolved", subject: "event-subject", filter: { kind: "attack" } },
      effect: { type: "test", target: "event-subject", modifier: { test: "hazard" } } });
    // The rider leaves nothing behind outside the option: no marker condition, no part of its own.
    expect(JSON.stringify(mechanics)).not.toContain("__dice-count");
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(choice), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("renders the repeated-result re-roll and names the triggering unit in the rider's moment", () => {
    const rendered = describeAbility(effectOf(text, items) as never);
    expect(rendered).toContain("re-rolling any repeated result");
    expect(rendered).toContain("after the triggering unit resolves its attacks");
  });

  it("refuses a count condition without an option, and an option with no plain D6 roll before it", () => {
    const withoutOption = items.filter(([, family]) => family !== "dice-count-option");
    expect(errorsOf(text, withoutOption)).toMatch(/needs a dice-count option/);
    const noRoll = items.filter(([, family]) => family !== "dice-roll");
    expect(errorsOf(text, noRoll)).toMatch(/offers another count of the one roll printed right before it/);
  });

  it("refuses a count condition that names a count the option does not offer", () => {
    const wrong = items.map((item): Item => item[1] === "dice-count-rolled" ? [item[0], item[1], { count: 3 }] : item);
    expect(errorsOf(text, wrong)).toMatch(/names a count the option does not offer/);
  });

  it("takes distinct only as true, and a count from 2 to 6", () => {
    expect(normalizeFingerprintParameters("dice-count-option", { count: 2, distinct: true })).toEqual({ count: 2, distinct: true });
    expect(normalizeFingerprintParameters("dice-count-option", { count: 3 })).toEqual({ count: 3 });
    expect(() => normalizeFingerprintParameters("dice-count-option", { count: 2, distinct: false })).toThrow(/true or absent/);
    expect(() => normalizeFingerprintParameters("dice-count-option", { count: 1 })).toThrow();
    expect(() => normalizeFingerprintParameters("dice-count-rolled", { count: 7 })).toThrow();
  });
});

describe("named units of a shared-roster faction", () => {
  it("resolve against the parent roster when the faction has no units file of its own", () => {
    const leaf: CompileLeaf = { role: "CONDITION", family_id: "unit-filter", family_version: currentFamilyVersion("unit-filter"),
      parameters: { side: "friendly", unit_names: ["Iron Father Feirros"] }, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" };
    expect(resolveUnitNames([leaf], { faction_id: "iron-hands" })[0]!.parameters).toEqual({ side: "friendly", unit_ids: ["iron-father-feirros"] });
  });
});
