import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { placements } from "../src/semantic-authoring/compile-placement.js";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Move-end destinations (move-end-nearest version 2: objective markers, selected objectives,
 * instead_of), the replacing cannot-end threshold (move-must-end version 4: replaces), the selected
 * trigger that a move end can attach to, and engaged end restrictions on a this-model subject.
 * Every wording is fabricated; each case pins one binding, one refusal, or one output shape.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
const base = (): Record<string, unknown> => (JSON.parse(readFileSync(join(dataRoot, "enrichment", "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

/** Leaves located by their wording in `text`, in order, so sentence and clause binding see real spans. */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

/** The compiled mechanics, after the entry validates against the ability schema and renders. */
function compiled(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base(), result.mechanics));
  expect(check.errors).toEqual([]);
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error("expected the record to be refused");
  return result.errors.join("; ");
}

describe("move-end-nearest version 2 parameters", () => {
  it("keeps version 1 as it was, and version 2 accepts and refuses exactly what it always did", () => {
    // Pinned at version 2 explicitly; the current version (3) widens version 2 and must not change these results.
    expect(normalizeFingerprintParameters("move-end-nearest", { to: "following-filter" }, 1)).toEqual({ to: "following-filter" });
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "closest-objective-marker" }, 1)).toThrow();
    expect(normalizeFingerprintParameters("move-end-nearest", { to: "closest-objective-marker", per: "model", instead_of: "closest-enemy-unit" }, 2))
      .toEqual({ to: "closest-objective-marker", per: "model", instead_of: "closest-enemy-unit" });
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "following-filter", per: "unit" }, 2)).toThrow(/applies only to an objective/u);
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "closest-objective" }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "selected-objective", instead_of: "closest-friendly-unit" }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "selected-objective", waives: "closest-enemy-model" }, 2)).toThrow();
  });
});

describe("move-end nearest to an objective (make-move, must)", () => {
  const text = "Your unit can make a Normal move. When doing so, it must end that move as close as possible to the closest objective marker.";
  const leaves = () => placed(text,
    ["can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
    ["must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker" }],
  );

  it("sets ends_nearest on the make-move to any objective marker", () => {
    const mechanics = compiled(leaves(), text);
    expect(JSON.stringify(mechanics)).toContain(JSON.stringify({ type: "move", target: "this-unit", modifier: { move_type: "normal", distance: "D6", ends_nearest: { of: { objective: {} } } } }));
  });

  it("adds per model and instead_of to the same value when the leaf names them", () => {
    const perModel = placed(text,
      ["can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker", per: "model", instead_of: "closest-enemy-unit" }],
    );
    const text2 = JSON.stringify(compiled(perModel, text));
    expect(text2).toContain('"ends_nearest":{"of":{"objective":{}},"per":"model","instead_of":"closest-enemy-unit"}');
  });

  it("does not change the unit destination of a following-filter end (version 1 golden)", () => {
    const unitText = "Your unit can make a Normal move. When doing so, it must end that move as close as possible to the closest enemy unit.";
    const unit = placed(unitText,
      ["can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["must end that move as close as possible to the closest", "move-end-nearest", { to: "following-filter" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
    );
    expect(JSON.stringify(compiled(unit, unitText))).toContain('"ends_nearest":{"of":{"owner":"enemy"}}');
  });

  it("refuses a selected-objective end with no select-objective, and with two", () => {
    const selectText = "Your unit can make a Normal move. When doing so, it must end that move as close as possible to that objective.";
    const moveItems: Array<[string, string, Record<string, unknown>]> = [
      ["can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["must end that move as close as possible to that objective", "move-end-nearest", { to: "selected-objective" }],
    ];
    expect(errorsOf(placed(selectText, ...moveItems), selectText)).toMatch(/selected objective needs exactly one select-objective/u);
    const twoText = `${selectText} Choose one objective marker. Choose another objective marker.`;
    const two: Array<[string, string, Record<string, unknown>]> = [
      ...moveItems,
      ["Choose one objective marker", "select-objective-open", { bind_as: "marker" }],
      ["Choose another objective marker", "select-objective-open", { bind_as: "other" }],
    ];
    // Two select-objective-open leaves are refused by the container planner before the destination check runs.
    expect(errorsOf(placed(twoText, ...two), twoText)).toMatch(/select-objective-open needs exactly one sentence/u);
  });

  it("binds a selected-objective end to the bind_as of the select-objective whose body holds it", () => {
    const text = "Choose one objective marker. Your unit can make a Normal move and must end that move as close as possible to that objective.";
    const mechanics = compiled(placed(text,
      ["Choose one objective marker", "select-objective-open", { bind_as: "marker" }],
      ["Your unit can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["must end that move as close as possible to that objective", "move-end-nearest", { to: "selected-objective" }],
    ), text);
    expect(mechanics.effect.type).toBe("select-objective");
    expect(mechanics.effect.selector).toEqual({ filter: {}, bind_as: "marker", count: { min: 1, max: 1 } });
    expect(JSON.stringify(mechanics.effect.effect)).toContain('"ends_nearest":{"of":{"objective":{"selection_var":"marker"}}}');
  });

  it("refuses a selected-objective end that comes before the select-objective binding it", () => {
    const text = "Your unit can make a Normal move and must end that move as close as possible to that objective. Choose one objective marker. Your unit gains fights first.";
    expect(errorsOf(placed(text,
      ["Your unit can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["must end that move as close as possible to that objective", "move-end-nearest", { to: "selected-objective" }],
      ["Choose one objective marker", "select-objective-open", { bind_as: "marker" }],
      ["Your unit gains fights first", "feel-no-pain", { subject: "this-model", threshold: 5 }],
    ), text)).toMatch(/comes before the select-objective that binds it/u);
  });

  it("reaches the compiler's exactly-one check when the ability has two select-objective leaves", () => {
    const text = "Your unit can make a Normal move and must end that move as close as possible to that objective. Choose one objective marker. Your unit gains fights first. Choose another objective marker. Your unit gains stealth.";
    expect(errorsOf(placed(text,
      ["Your unit can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["must end that move as close as possible to that objective", "move-end-nearest", { to: "selected-objective" }],
      ["Choose one objective marker", "select-objective-open", { bind_as: "marker" }],
      ["Your unit gains fights first", "feel-no-pain", { subject: "this-model", threshold: 5 }],
      ["Choose another objective marker", "select-objective-open", { bind_as: "other" }],
      ["Your unit gains stealth", "feel-no-pain", { subject: "this-model", threshold: 4 }],
    ), text)).toMatch(/selected objective needs exactly one select-objective in its ability/u);
  });

  it("refuses an objective destination followed by a unit-filter, which it does not consume", () => {
    const orphanText = "Your unit can make a Normal move. When doing so, it must end that move as close as possible to the closest objective marker enemy unit.";
    const orphan = placed(orphanText,
      ["can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
    );
    expect(errorsOf(orphan, orphanText)).toMatch(/unit-filter/u);
  });
});

describe("move-end nearest on a selected move (no make-move in the sentence)", () => {
  it("attaches the end to the selected move's kinds as a move-modifier on the selected unit", () => {
    const text = "Each time your unit is selected to make a Surge move, it must end that move as close as possible to the closest objective marker.";
    const mechanics = compiled(placed(text,
      ["is selected to make a Surge move", "event", { kind: "selected", move_types: ["surge"] }],
      ["must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker" }],
    ), text);
    expect(JSON.stringify(mechanics)).toContain(JSON.stringify({ type: "move-modifier", target: "event-subject", modifier: { applies_to_moves: ["surge"], ends_nearest: { of: { objective: {} } } } }));
  });

  it("refuses a second move-end on the same selected move, which has no DSL form", () => {
    const text = "Each time your unit is selected to make a Surge move, it must end that move as close as possible to the closest objective marker. It must end that move as close as possible to the closest objective marker.";
    expect(errorsOf(placed(text,
      ["is selected to make a Surge move", "event", { kind: "selected", move_types: ["surge"] }],
      ["must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker" }],
      ["It must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker" }],
    ), text)).toMatch(/second move-end nearest/u);
  });

  it("refuses an end after a move-ended trigger, which has no move left to end", () => {
    const text = "Each time your unit ends a Normal move, it must end that move as close as possible to the closest objective marker.";
    expect(errorsOf(placed(text,
      ["ends a Normal move", "event", { kind: "move-ended", move_types: ["normal"] }],
      ["must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker" }],
    ), text)).toMatch(/already ended/u);
  });

  it("refuses an end with no move and no selection that names moves; a move-started trigger does not count", () => {
    const text = "Your unit must end that move as close as possible to the closest objective marker.";
    expect(errorsOf(placed(text,
      ["must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker" }],
    ), text)).toMatch(/has no move to attach to/u);
    const started = "Each time your unit starts a Normal move, it must end that move as close as possible to the closest objective marker.";
    expect(errorsOf(placed(started,
      ["starts a Normal move", "event", { kind: "move-started", move_types: ["normal"] }],
      ["must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker" }],
    ), started)).toMatch(/has no move to attach to/u);
  });
});

describe("replacing cannot-end threshold (move-must-end version 4)", () => {
  it("is version 4, takes replaces only with cannot, and keeps move_types out of the replacement", () => {
    expect(currentFamilyVersion("move-must-end")).toBe(4);
    expect(normalizeFingerprintParameters("move-must-end", { match: "all", polarity: "cannot", replaces: true }, 4)).toEqual({ match: "all", polarity: "cannot", replaces: true });
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", polarity: "must", replaces: true }, 4)).toThrow(/applies only to polarity cannot/u);
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", replaces: true }, 4)).toThrow(/applies only to polarity cannot/u);
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", polarity: "cannot", replaces: false }, 4)).toThrow(/must be true/u);
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", polarity: "cannot", move_types: ["ingress"] }, 4)).toThrow();
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", polarity: "cannot", move_types: ["ingress"] }, 3)).toThrow();
  });
});

/** Every object in a compiled tree that `matches`, depth first. */
function nodesWhere(value: unknown, matches: (node: Record<string, any>) => boolean): Array<Record<string, any>> {
  if (Array.isArray(value)) return value.flatMap((item) => nodesWhere(item, matches));
  if (value === null || typeof value !== "object") return [];
  const node = value as Record<string, any>;
  return [...(matches(node) ? [node] : []), ...Object.values(node).flatMap((item) => nodesWhere(item, matches))];
}

const selectedMoveText = "Each time your unit is picked to make a Normal or Advance move with the Quantum Gadget ability, your unit can end that move more than 6\" from all enemy units (instead of more than 8\").";
const selectedMoveItems = (moves: unknown = ["normal", "advance"]): Array<[string, string, Record<string, unknown>]> => [
  ["is picked to make a Normal or Advance move", "event", { kind: "selected", ...(moves === null ? {} : { move_types: moves }) }],
  ["the Quantum Gadget ability", "by-ability", { id: "quantum-gadget" }],
  ["can end that move", "move-must-end", { match: "all", polarity: "cannot", replaces: true }],
  ["more than 6\" from", "unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false, of: "following-filter" }],
  ["enemy units", "unit-filter", { side: "enemy" }],
  ["(instead of more than 8\")", "instead", {}],
];
const selectedMoveLeaves = (text = selectedMoveText, moves: unknown = ["normal", "advance"]) => placed(text, ...selectedMoveItems(moves));

describe("the 9046 sentence-1 shape: selected move, by-ability, replacing distance end", () => {
  it("ends the selected move no closer than the distance, replacing the usual threshold, for the kinds the selection names", () => {
    const mechanics = compiled(selectedMoveLeaves(), selectedMoveText);
    const modifiers = nodesWhere(mechanics, (node) => node.type === "move-modifier" && (node.modifier as Record<string, unknown> | undefined)?.ends_when_replaces === true);
    expect(modifiers).toHaveLength(1);
    expect(modifiers[0]!.target).toBe("this-unit");
    expect(modifiers[0]!.modifier.applies_to_moves).toEqual(["normal", "advance"]);
    expect(modifiers[0]!.modifier.ends_when.operator).toBe("not");
  });

  it("gates the replacing end on the selection's ability, so it is not an unscoped rule", () => {
    const mechanics = compiled(selectedMoveLeaves(), selectedMoveText);
    expect(JSON.stringify(mechanics)).toContain("happened");
  });

  it("refuses a replacing end with a make-move in its ability", () => {
    const full = `${selectedMoveText} Your unit can make a Normal move.`;
    const withMove = placed(full, ...selectedMoveItems(), ["can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }]);
    expect(errorsOf(withMove, full)).toMatch(/no DSL form with a make-move/u);
  });

  it("refuses a replacing end whose trigger names no moves", () => {
    expect(errorsOf(selectedMoveLeaves(selectedMoveText, null), selectedMoveText)).toMatch(/names its moves/u);
  });

  it("refuses a replacing end that names its own move kinds", () => {
    const leaves = selectedMoveLeaves().map((item) => item.family_id === "move-must-end" ? { ...item, parameters: { ...item.parameters, move_types: ["normal"] } } : item);
    expect(errorsOf(leaves, selectedMoveText)).toMatch(/takes its move kinds from the trigger/u);
  });
});

describe("an instead consumed by a replacing move-end keeps the other effect in its clause (SS-F)", () => {
  const text = "Each time your unit is picked to make a Normal move with the Quantum Gadget ability, re-roll a Hit roll of 1, and your unit can end that move more than 6\" from all enemy units (instead of more than 8\").";
  const reroll: [string, string, Record<string, unknown>] = ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }];
  const items = (extra: Array<[string, string, Record<string, unknown>]> = []): Array<[string, string, Record<string, unknown>]> => [
    ["is picked to make a Normal move", "event", { kind: "selected", move_types: ["normal"] }],
    ["the Quantum Gadget ability", "by-ability", { id: "quantum-gadget" }],
    reroll,
    ...extra,
    ["can end that move", "move-must-end", { match: "all", polarity: "cannot", replaces: true }],
    ["more than 6\" from", "unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false, of: "following-filter" }],
    ["enemy units", "unit-filter", { side: "enemy" }],
    ["(instead of more than 8\")", "instead", {}],
  ];

  it("keeps the re-roll unchanged and gives the replacing end the instead", () => {
    const mechanics = compiled(placed(text, ...items()), text);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps[0]).toEqual({ type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } });
    expect(steps[1]!.modifier.ends_when_replaces).toBe(true);
  });

  it("refuses an instead with two effects besides the move-end", () => {
    const wider = "Each time your unit is picked to make a Normal move with the Quantum Gadget ability, re-roll a Hit roll of 1, re-roll a Wound roll of 1, and your unit can end that move more than 6\" from all enemy units (instead of more than 8\").";
    const second: [string, string, Record<string, unknown>] = ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }];
    expect(errorsOf(placed(wider, ...items([second])), wider)).toMatch(/besides the move-end/u);
  });
});

describe("engaged end restriction with a this-model subject (7010 shape)", () => {
  const text = "Each time this model makes a Normal move, it can move through enemy models, but cannot end that move within Engagement Range of them.";
  const leaves = (withThrough = true) => placed(text,
    ["makes a Normal move", "event", { kind: "move-ended", move_types: ["normal"] }],
    ...(withThrough ? [["move through enemy models", "move-through", { subject: "this-model", passthrough: "models" }] as [string, string, Record<string, unknown>]] : []),
    ["cannot end that move", "move-must-end", { match: "all", polarity: "cannot" }],
    ["within Engagement Range", "unit-state", { states: ["engaged"], subject: "this-model", negated: false }],
  );

  it("binds the end restriction to the this-model move-through, with the trigger's moves", () => {
    const mechanics = compiled(leaves(), text);
    const modifiers = nodesWhere(mechanics, (node) => node.type === "move-modifier" && (node.modifier as Record<string, unknown> | undefined)?.no_end_in_engagement === true);
    expect(modifiers).toHaveLength(1);
    expect(modifiers[0]!.target).toBe("this-model");
    expect(modifiers[0]!.modifier.applies_to_moves).toEqual(["normal"]);
  });

  it("refuses a this-model end with no bound move-through for this model", () => {
    expect(errorsOf(leaves(false), text)).toMatch(/covers this model only/u);
  });
});

describe("refusals kept from the design", () => {
  it("refuses a move-end waiver and an instead-of end in one sentence", () => {
    const text = "Your unit can make a Normal move, and it must end that move as close as possible to the closest enemy unit, instead of closer to the closest enemy model.";
    const list = placed(text,
      ["can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["must end that move as close as possible to the closest", "move-end-nearest", { to: "following-filter", instead_of: "closest-enemy-unit" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["closer to the closest enemy model", "move-end-waiver", { rule: "closest-enemy-model" }],
    );
    expect(errorsOf(list, text)).toMatch(/move-end waiver and/u);
  });
});

describe("a move-end destination in a sentence that says can (optional, refused)", () => {
  it("refuses the objective end of a sentence with can and no must (the 9858 row 2 shape)", () => {
    const text = "Your unit can make a Normal move, and can end that move as close as possible to the closest objective marker instead of as close as possible to the closest enemy unit.";
    const list = placed(text,
      ["can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["can end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker", instead_of: "closest-enemy-unit" }],
    );
    expect(errorsOf(list, text)).toMatch(/optional/u);
  });

  it("compiles the same destination in a sentence with must (the 4210 shape)", () => {
    const text = "Your unit can make a Normal move. When doing so, it must end that move as close as possible to the closest objective marker.";
    const list = placed(text,
      ["can make a Normal move", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["must end that move as close as possible to the closest objective marker", "move-end-nearest", { to: "closest-objective-marker" }],
    );
    expect(JSON.stringify(compiled(list, text))).toContain('"ends_nearest":{"of":{"objective":{}}}');
  });
});

describe("feasibility proviso on a distance bonus (2306 shape)", () => {
  it("sets the bonus node's ends_when to the engaged condition", () => {
    const text = "Your unit can move an additional 3\" as long as your unit can end that move within Engagement Range of one or more enemy units.";
    const list = placed(text,
      ["can move an additional 3\"", "move-distance", { subject: "this-unit", move_types: ["normal"], bonus: 3 }],
      ["as long as your unit can end that move", "move-must-end", { match: "any" }],
      ["within Engagement Range of one or more enemy units", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false }],
    );
    const bonuses = nodesWhere(compiled(list, text), (node) => node.type === "move-modifier" && (node.modifier as Record<string, unknown> | undefined)?.distance_bonus !== undefined);
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0]!.modifier.ends_when).toEqual({ type: "matches", parameters: { filter: { state: "engaged" } } });
  });
});

describe("ability-scoped charge ban on the ability's move (9046 sentence 2, not yet authored)", () => {
  const text = "Each time your unit is picked to make a Normal move with the Quantum Gadget ability, your unit can end that move more than 6\" from all enemy units. When this unit ends that move within 8\" of an enemy unit, this unit is not eligible to declare a charge until the end of the turn.";
  const list = () => placed(text,
    ["is picked to make a Normal move", "event", { kind: "selected", move_types: ["normal"] }],
    ["the Quantum Gadget ability", "by-ability", { id: "quantum-gadget" }],
    ["can end that move", "move-must-end", { match: "all", polarity: "cannot", replaces: true }],
    ["more than 6\" from", "unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false, of: "following-filter" }],
    ["enemy units", "unit-filter", { side: "enemy" }],
    ["ends that move within 8\"", "event", { kind: "move-ended", move_types: ["normal", "advance"] }],
    ["not eligible to declare a charge", "eligibility-permission", { subject: "this-unit", activity: "charge", allow: false }],
  );

  // The record compiles today; only the ability scope is missing. The expected-failure test asserts
  // a successful compile first, so it can fail only on the missing condition, not on a refusal.
  it("compiles sentence 2 with its trigger and permission, with no ability condition yet", () => {
    expect(compileLeaves(list(), text).ok).toBe(true);
  });

  // Expected output, not yet produced: each permission follows a trigger that names the ability's
  // move. Sentence 2 cannot yet bind to sentence 1's move, so this test is expected to fail.
  it.fails("gives every permission trigger the ability condition", () => {
    const result = compileLeaves(list(), text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const triggers = nodesWhere(result.mechanics, (node) => node.event !== undefined || node.kind !== undefined);
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) expect(JSON.stringify(trigger)).toContain("happened");
  });
});

describe("a bold paragraph opens a clause of its own (the Restrictions paragraph of an instead clause)", () => {
  const text = "Each time your unit makes a Normal move, instead of its usual move, it can end that move as close as possible to that objective instead.";
  const heading = `${text}\n**Restrictions:** Your army can include one unit of this kind.`;
  const items = (source: string): Array<[string, string, Record<string, unknown>]> => [
    ["makes a Normal move", "event", { kind: "move-ended", move_types: ["normal"] }],
    ["instead of its usual move", "instead", {}],
    ["Your army can include one unit of this kind", "army-includes", {}],
  ];
  it("starts a new clause at a line that opens with bold text", () => {
    const places = placements(placed(heading, ...items(heading)), heading);
    expect(places[2]!.clause).not.toBe(places[0]!.clause);
  });
  it("keeps the same clause when the same wording follows on the same line", () => {
    const plain = `${text} Your army can include one unit of this kind.`;
    const places = placements(placed(plain, ...items(plain)), plain);
    expect(places[2]!.clause).toBe(places[0]!.clause);
  });
});
