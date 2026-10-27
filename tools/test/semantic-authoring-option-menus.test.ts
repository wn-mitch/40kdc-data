import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/effect.js";

/*
 * Fabricated wording. A unit is readied at the start of the Command phase; while it is readied the
 * player may use one drill, each with its own moment, and using one ends the readied state.
 */

const TEXT = [
  "At the start of your Command phase, friendly ALPHA units are readied. While a friendly unit is readied, you can select one of the drills below for that unit. If you do, that unit is no longer readied.",
  "**Drill One**",
  "Your Movement phase, when that unit is selected to move. Your unit has +1 M.",
  "**Drill Two**",
  "Start of the Fight phase. Your unit's melee attacks can re-roll hit rolls of 1.",
].join("\n");

type Piece = [phrase: string, family: string, parameters: Record<string, unknown>];

const READIED: Piece[] = [
  ["At the start of your Command phase", "event", { kind: "phase-start", phase: "command", turn: "your" }],
  ["friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
  ["are readied", "apply-mark", { subject: "antecedent", tag: "readied" }],
  ["friendly unit is readied", "designated-filter", { subject: "this-unit", tag: "readied", negated: false }],
  ["you can", "optional-use", { who: "you" }],
  ["select one of the drills below for that unit", "stance-select-open", { scope: "unit", mode: "re-selectable", min_choices: 1, max_choices: 1 }],
];
const CLEAR: Piece = ["that unit is no longer readied", "apply-mark", { subject: "antecedent", tag: "readied", clear: true }];
const DRILLS: Piece[] = [
  ["Drill One", "named-option", { label: "Drill One", option_id: "drill-one" }],
  ["Your Movement phase", "phase-window", { phase: "movement", turn: "your" }],
  ["selected to move", "event", { kind: "selected", to: "move" }],
  ["Your unit has +1 M", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 1 }],
  ["Drill Two", "named-option", { label: "Drill Two", option_id: "drill-two" }],
  ["Start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
  ["can re-roll hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "melee", subject: "this-unit" }],
];

function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, family_id, parameters]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at));
    const family_version = currentFamilyVersion(family_id);
    return {
      role: familyRole(family_id, family_version), family_id, family_version,
      parameters: normalizeFingerprintParameters(family_id, parameters, family_version),
      start_byte, end_byte: start_byte + Buffer.byteLength(phrase), fragment: "RAW_TEXT",
    };
  });
}

type Node = Record<string, unknown>;
function compiled(pieces: Piece[], text = TEXT): Node {
  const result = compileLeaves(leavesIn(text, pieces), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Node;
}
const stanceOf = (part: Node): Node => {
  const effect = part.effect as Node;
  return (effect.type === "conditional" ? effect.effect : effect) as Node;
};

describe("A menu whose options carry their own moments", () => {
  it("is its own part, used at each option's moment rather than the earlier sentence's", () => {
    const mechanics = compiled([...READIED, CLEAR, ...DRILLS]);
    const parts = (mechanics.effect as Node).steps as Node[];
    expect(parts).toHaveLength(2);
    expect((parts[0]!.trigger as Node).event).toBe("phase-started");
    // The menu has no moment of its own and no lifetime borrowed from its options' windows.
    expect(parts[1]!.trigger).toBeUndefined();
    expect(parts[1]!.duration).toBeUndefined();
    expect(stanceOf(parts[1]!).type).toBe("stance-select");
  });

  it("makes the effect printed before the first option a step of every option's own part", () => {
    const parts = (compiled([...READIED, CLEAR, ...DRILLS]).effect as Node).steps as Node[];
    const options = stanceOf(parts[1]!).options as Node[];
    for (const option of options) {
      const part = option.effect as Node;
      expect(part.type).toBe("ability-part");
      expect(((part.effect as Node).steps as Node[])[0]).toEqual({ type: "designate", target: "this-unit", modifier: { tag: "readied", clear: true } });
    }
    // Without the printed clear, no option ends the readied state.
    const plain = (compiled([...READIED, ...DRILLS]).effect as Node).steps as Node[];
    expect(JSON.stringify(stanceOf(plain[1]!))).not.toContain("\"clear\":true");
  });

  it("gives an option at the start of a phase that phase as its lifetime (core rule 01.02.02)", () => {
    const parts = (compiled([...READIED, CLEAR, ...DRILLS]).effect as Node).steps as Node[];
    const drillTwo = (stanceOf(parts[1]!).options as Node[]).find((option) => option.id === "drill-two")!;
    expect((drillTwo.effect as Node).duration).toBe("phase");
  });
});

describe("A start-of-phase moment with a lasting effect", () => {
  const text = "At the start of the Fight phase, this unit's melee attacks can re-roll hit rolls of 1.";
  const pieces: Piece[] = [
    ["At the start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
    ["can re-roll hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "melee", subject: "this-unit" }],
  ];

  it("lasts until the end of that phase", () => {
    expect((compiled(pieces, text).scope as Node).duration).toBe("phase");
  });
});

/**
 * An officer's datasheet ability prints how many Orders it issues and to which units, but no Orders
 * of its own: those are its faction's army rule's (Voice of Command), so the compiled issue-orders
 * names that rule as `menu_from`, and an "only these Orders" rule narrows it to option ids.
 */

// Fabricated wording in the shape of an officer's datasheet ability, not rules text.
const SOURCE = "This leader can give up to 2 Orders to SQUAD or TANK units. This leader can only give the Duty and Honour! and Fix Bayonets! Orders.";
const FACTION = { units: { faction_id: "astra-militarum" }, abilityId: "orders-example-astra-militarum" };

function at(text: string, role: string, family_id: string, family_version: number, parameters: Record<string, unknown>): CompileLeaf {
  const start = SOURCE.indexOf(text);
  if (start < 0) throw new Error(`Missing ${text}`);
  return { role, family_id, family_version, parameters, start_byte: start, end_byte: start + text.length, fragment: "RAW_TEXT" };
}

const opener = at("This leader can give up to 2 Orders", "EFFECT", "issue-orders-open", 1, { count: 2 });
const units = at("SQUAD or TANK units", "CONDITION", "unit-filter", 18, { side: "friendly", any_keywords: ["SQUAD", "TANK"] });
const only = (orders: string[]) => at("This leader can only give the Duty and Honour! and Fix Bayonets! Orders", "RESTRICTION", "order-rule", 2, { rule: "only-orders", orders });

function ordersCompiled(leaves: CompileLeaf[], options: Parameters<typeof compileLeaves>[2] = FACTION) {
  const result = compileLeaves(leaves, SOURCE, options);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

describe("an officer's Orders from its army rule's menu", () => {
  it("names the faction's Orders menu, the eligible units and the Orders it is limited to", () => {
    const mechanics = ordersCompiled([opener, units, only(["Duty and Honour!", "Fix Bayonets!"])]);
    expect(mechanics.effect).toEqual({
      type: "issue-orders",
      menu_from: "voice-of-command-astra-militarum",
      count: 2,
      eligible: { any_of: ["SQUAD", "TANK"] },
      only_options: ["duty-and-honour", "fix-bayonets"],
    });
    expect(describeAbility({ ability_id: "orders-example", name: "Orders", ...(mechanics as Record<string, unknown>) })).toBe(
      "This model can issue up to 2 Orders from Voice of Command to eligible friendly units with the SQUAD or TANK keyword, only Duty and Honour or Fix Bayonets.",
    );
  });

  it("reads one filter per bullet as alternatives, not keywords every unit must have", () => {
    const bulleted = "This leader can give up to 3 Orders to:\n■ **SQUAD** units\n■ **TANK** units\n■ **WALKER** units";
    const leafAt = (text: string, role: string, family_id: string, family_version: number, parameters: Record<string, unknown>): CompileLeaf => {
      const start = Buffer.byteLength(bulleted.slice(0, bulleted.indexOf(text)));
      return { role, family_id, family_version, parameters, start_byte: start, end_byte: start + Buffer.byteLength(text), fragment: "RAW_TEXT" };
    };
    const result = compileLeaves([
      leafAt("This leader can give up to 3 Orders", "EFFECT", "issue-orders-open", 1, { count: 3 }),
      ...["SQUAD", "TANK", "WALKER"].map((keyword) => leafAt(`${keyword}** units`, "CONDITION", "unit-filter", 18, { side: "friendly", keywords: [keyword] })),
    ], bulleted, FACTION);
    expect(result.ok ? result.mechanics.effect : result.errors).toMatchObject({ eligible: { any_of: ["SQUAD", "TANK", "WALKER"] } });
  });

  it("refuses a menu it cannot find, an Order the menu does not list, and Orders to enemy units", () => {
    const errors = (leaves: CompileLeaf[], options: Parameters<typeof compileLeaves>[2] = FACTION) => {
      const result = compileLeaves(leaves, SOURCE, options);
      return result.ok ? [] : result.errors;
    };
    // No faction: no army rule to take the Orders from.
    expect(errors([opener, units], {})).toEqual([expect.stringContaining("needs its faction's one army rule")]);
    expect(errors([opener, units, only(["Duty and Honour!", "Charge the Walls!"])])).toEqual([expect.stringContaining("are not all Orders of the faction's army rule")]);
    // An enemy unit-filter is not who an Order goes to.
    expect(errors([opener, { ...units, parameters: { side: "enemy", any_keywords: ["SQUAD", "TANK"] } }])).toEqual([expect.stringContaining("issued to friendly units")]);
  });
});
