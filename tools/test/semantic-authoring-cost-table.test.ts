import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

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
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-cost-table" });

function compiled(text: string, ...items: Item[]): Record<string, unknown> {
  const result = run(text, ...items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Record<string, unknown>;
}

function errorsOf(text: string, ...items: Item[]): string {
  const result = run(text, ...items);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics.effect)}`);
  return result.errors.join("; ");
}

/** Every node of a type in a compiled effect tree. */
function nodes(tree: unknown, type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if ((node as Record<string, unknown>).type === type) found.push(node as Record<string, unknown>);
      Object.values(node).forEach(walk);
    }
  };
  walk(tree);
  return found;
}

const POOL = "alpha-points";
const TEXT = "Each time a unit from your army is destroyed, you can spend the alpha points shown below based on that unit's Starting Strength. Alpha Squad. For 5 models, you must spend 2 alpha points. For 10 models, you must spend 4 alpha points. Bravo Pack, or Charlie Pack. For 10 models, you must spend 3 alpha points.";
const DESTROYED: Item = ["Each time a unit from your army is destroyed", "event", { kind: "unit-destroyed", object_owner: "friendly" }];
const CAN: Item = ["you can", "optional-use", { who: "you" }];
const SPEND: Item = ["spend the alpha points shown below based on that unit's Starting Strength", "resource-spend", { pool: POOL, amount: "by-table", table_of: "antecedent" }];
const ALPHA: Item = ["Alpha Squad", "unit-filter", { side: "friendly", datasheets: ["alpha-squad"] }];
const ROW_5: Item = ["For 5 models, you must spend 2 alpha points.", "resource-spend", { pool: POOL, amount: 2, starting_strength: 5 }];
const ROW_10: Item = ["For 10 models, you must spend 4 alpha points.", "resource-spend", { pool: POOL, amount: 4, starting_strength: 10 }];
const BRAVO: Item = ["Bravo Pack, or Charlie Pack", "unit-filter", { side: "friendly", datasheets: ["bravo-pack", "charlie-pack"] }];
const ROW_B: Item = ["For 10 models, you must spend 3 alpha points.", "resource-spend", { pool: POOL, amount: 3, starting_strength: 10 }];

describe("Semantic authoring cost table: a spend read from the table after it", () => {
  it("folds each heading's rows into one by-table spend, read for the destroyed unit", () => {
    const spends = nodes(compiled(TEXT, DESTROYED, CAN, SPEND, ALPHA, ROW_5, ROW_10, BRAVO, ROW_B), "resource-spend");
    expect(spends).toHaveLength(1);
    expect(spends[0]!.modifier).toEqual({
      pool: POOL,
      amount: "by-table",
      amount_table: [
        { unit_ids: ["alpha-squad"], starting_strength: 5, amount: 2 },
        { unit_ids: ["alpha-squad"], starting_strength: 10, amount: 4 },
        { unit_ids: ["bravo-pack", "charlie-pack"], starting_strength: 10, amount: 3 },
      ],
      // A destruction with no destroyer names the destroyed unit as the trigger's object.
      table_of: "event-object",
    });
  });

  it("refuses a row before any heading names its datasheets", () => {
    const text = TEXT.replace("Alpha Squad. For 5 models, you must spend 2 alpha points.", "For 5 models, you must spend 2 alpha points. Alpha Squad.");
    expect(errorsOf(text, DESTROYED, CAN, SPEND, ROW_5, ALPHA, ROW_10, BRAVO, ROW_B)).toContain("comes before any table heading");
  });

  it("refuses a heading with no rows under it", () => {
    const text = TEXT.replace("Bravo Pack, or Charlie Pack.", "Delta Squad. Bravo Pack, or Charlie Pack.");
    const delta: Item = ["Delta Squad", "unit-filter", { side: "friendly", datasheets: ["delta-squad"] }];
    expect(errorsOf(text, DESTROYED, CAN, SPEND, ALPHA, ROW_5, ROW_10, delta, BRAVO, ROW_B)).toContain("has no rows after it");
  });

  it("refuses a row with no by-table spend to belong to", () => {
    const text = "Each time a unit from your army is destroyed, you can do this. For 5 models, you must spend 2 alpha points.";
    expect(errorsOf(text, DESTROYED, CAN, ["For 5 models, you must spend 2 alpha points.", "resource-spend", { pool: POOL, amount: 2, starting_strength: 5 }]))
      .toContain("has no by-table spend before it");
  });

  it("refuses a row that spends a different pool from its table", () => {
    const other: Item = ["For 10 models, you must spend 3 alpha points.", "resource-spend", { pool: "bravo-points", amount: 3, starting_strength: 10 }];
    expect(errorsOf(TEXT, DESTROYED, CAN, SPEND, ALPHA, ROW_5, ROW_10, BRAVO, other)).toContain("spends a different pool");
  });

  it("refuses two rows for one datasheet at one Starting Strength", () => {
    const again: Item = ["For 10 models, you must spend 3 alpha points.", "resource-spend", { pool: POOL, amount: 3, starting_strength: 10 }];
    const text = TEXT.replace("Bravo Pack, or Charlie Pack. ", "");
    expect(errorsOf(text, DESTROYED, CAN, SPEND, ALPHA, ROW_5, ROW_10, again)).toContain("two rows for one datasheet");
  });

  it("rejects a starting_strength on the by-table spend itself", () => {
    expect(() => normalizeFingerprintParameters("resource-spend", { pool: POOL, amount: "by-table", table_of: "antecedent", starting_strength: 5 }, currentFamilyVersion("resource-spend")))
      .toThrow(/a by-table spend has none/u);
  });
});

describe("Semantic authoring board lowerings around Cult Ambush", () => {
  it("keeps where a selected unit is held when its filter folds into the selection", () => {
    const text = "At the end of the phase, you can select one unit from your army that is in Strategic Reserves. Set that unit up on the battlefield.";
    const effect = compiled(text,
      ["At the end of the phase", "event", { kind: "phase-end", phase: "movement", turn: "your" }],
      ["you can", "optional-use", { who: "you" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["unit from your army that is in Strategic Reserves", "unit-filter", { side: "friendly", held_in: "strategic-reserves" }],
      ["Set that unit up on the battlefield", "set-up", { subject: "antecedent", to: "battlefield" }]);
    expect((nodes(effect, "select-units")[0]!.selector as Record<string, unknown>).filter).toEqual({ owner: "friendly", state: "in-strategic-reserves" });
  });

  it("starts a sentence at a moment on a new line, so a later condition does not gate the line before it", () => {
    // No full stop before the line break, as at the end of a bulleted list.
    const text = "You gain 3 alpha points\nEach time a unit from your army is destroyed, if that unit has this ability, you gain 1 alpha point.";
    const effect = compiled(text,
      ["You gain 3 alpha points", "resource-gain", { pool: POOL, amount: 3 }],
      DESTROYED,
      ["that unit has this ability", "unit-has-ability", { own: true, subject: "antecedent" }],
      ["you gain 1 alpha point", "resource-gain", { pool: POOL, amount: 1 }]);
    const gains = nodes(effect, "resource-gain");
    expect(gains).toHaveLength(2);
    // The first gain is not inside the conditional the second sentence's has-ability test makes.
    const gated = nodes(effect, "conditional").flatMap((node) => nodes(node, "resource-gain"));
    expect(gated.map((gain) => (gain.modifier as Record<string, unknown>).amount)).not.toContain(3);
  });
});
