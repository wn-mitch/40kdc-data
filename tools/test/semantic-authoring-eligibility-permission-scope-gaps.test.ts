import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { foldAsIfPhases } from "../src/semantic-authoring/compile-as-if.js";
import { foldFightNext } from "../src/semantic-authoring/compile-fight-next.js";
import { sentenceSegments } from "../src/semantic-authoring/compile-segments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { familyExtension } from "../src/semantic-authoring/families/index.js";

/** The family versions the extensions under test create. */
const ELIGIBILITY_PERMISSION_SCOPE_GAPS_VERSIONS: ReadonlySet<string> = new Set(["eligibility-permission@8", "no-advance-roll@4"]);

// Fabricated wording only; no rules text.

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves on their own wording in `text`, in order. */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
}

function compiled(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function refused(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  if (result.ok) throw new Error("compiled, but should refuse");
  return result.errors.join("; ");
}

/** Every node of a compiled tree that satisfies `test`. */
function nodes(tree: unknown, test: (node: Record<string, any>) => boolean): Array<Record<string, any>> {
  const found: Array<Record<string, any>> = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node === null || typeof node !== "object") return;
    if (test(node as Record<string, any>)) found.push(node as Record<string, any>);
    Object.values(node).forEach(walk);
  };
  walk(tree);
  return found;
}

const normalize = (family: string, parameters: Record<string, unknown>, version = currentFamilyVersion(family)) => normalizeFingerprintParameters(family, parameters, version);

/** The version just before this bundle's extension of `family`; later extensions may sit above it. */
const PREVIOUS = (family: string): number => {
  for (let version = currentFamilyVersion(family); version > 1; version -= 1) {
    const extension = familyExtension(family, version);
    if (extension !== undefined && ELIGIBILITY_PERMISSION_SCOPE_GAPS_VERSIONS.has(`${extension.family}@${extension.version}`)) return version - 1;
  }
  throw new Error(`The bundle does not extend ${family}.`);
};

describe("eligibility-permission reach and next (fight only)", () => {
  const base = { subject: "this-unit", activity: "fight", allow: true };

  it("accepts reach and next on a granting fight permission, and not at the version before", () => {
    expect(normalize("eligibility-permission", { ...base, reach: 3 })).toEqual({ ...base, reach: 3 });
    expect(normalize("eligibility-permission", { ...base, next: true, despite: ["fought-this-phase"] })).toEqual({ ...base, next: true, despite: ["fought-this-phase"] });
    expect(normalize("eligibility-permission", { ...base, reach: 12, next: true })).toEqual({ ...base, reach: 12, next: true });
    expect(() => normalize("eligibility-permission", { ...base, reach: 3 }, PREVIOUS("eligibility-permission"))).toThrow();
    expect(() => normalize("eligibility-permission", { ...base, next: true }, PREVIOUS("eligibility-permission"))).toThrow();
  });

  it("still accepts every leaf the previous version accepted", () => {
    for (const leaf of [
      base,
      { ...base, despite: ["fought-this-phase"] },
      { subject: "this-unit", activity: "shoot", allow: true, despite: ["fell-back"] },
      { subject: "this-unit", activity: "shoot", allow: false, as_if: "snap-shooting" },
      { subject: "this-unit", activity: "embark", allow: true, into: "this-unit" },
      { subject: "event-subject", activity: "move", allow: true, despite: ["engaged"] },
    ]) {
      expect(normalize("eligibility-permission", leaf, PREVIOUS("eligibility-permission"))).toEqual(normalize("eligibility-permission", leaf));
    }
  });

  it("refuses reach or next outside a granting fight permission, and out-of-range values", () => {
    expect(() => normalize("eligibility-permission", { ...base, activity: "shoot", reach: 3 })).toThrow(/only to activity: fight/u);
    expect(() => normalize("eligibility-permission", { ...base, activity: "declare-charge", next: true })).toThrow(/only to activity: fight/u);
    expect(() => normalize("eligibility-permission", { ...base, allow: false, next: true })).toThrow(/need allow: true/u);
    expect(() => normalize("eligibility-permission", { ...base, allow: false, reach: 3 })).toThrow(/need allow: true/u);
    expect(() => normalize("eligibility-permission", { ...base, reach: 13 })).toThrow();
    expect(() => normalize("eligibility-permission", { ...base, reach: 0 })).toThrow();
    expect(() => normalize("eligibility-permission", { ...base, next: false })).toThrow(/must be true/u);
  });

  it("lowers reach and next onto the permission modifier", () => {
    const text = "Until the end of the phase, models in your unit within reach are eligible to fight.";
    const reach = compiled(text, ["models in your unit within reach are eligible to fight", "eligibility-permission", { ...base, reach: 3 }]);
    expect(nodes(reach, (node) => node.type === "permission")[0]!.modifier).toEqual({ activity: "fight", allow: true, reach: { inches: 3 } });
    const next = compiled(text, ["models in your unit within reach are eligible to fight", "eligibility-permission", { ...base, next: true }]);
    expect(nodes(next, (node) => node.type === "permission")[0]!.modifier).toEqual({ activity: "fight", allow: true, next: true });
  });
});

describe("fight next merges into the fight permission before it", () => {
  const text = "Your unit is eligible to fight even if it has fought and must be selected to fight next.";
  const grant = ["is eligible to fight even if it has fought", "eligibility-permission", { subject: "this-unit", activity: "fight", allow: true, despite: ["fought-this-phase"] }] as Item;
  const next = ["must be selected to fight next", "eligibility-permission", { subject: "this-unit", activity: "fight", allow: true, next: true }] as Item;

  it("merges a bare next leaf into the grant directly before it", () => {
    const permissions = nodes(compiled(text, grant, next), (node) => node.type === "permission");
    expect(permissions).toHaveLength(1);
    expect(permissions[0]!.modifier).toEqual({ activity: "fight", allow: true, despite: ["fought-this-phase"], next: true });
  });

  it("keeps two permissions when the subjects differ or a sentence stop sits between", () => {
    const other = ["must be selected to fight next", "eligibility-permission", { subject: "this-model", activity: "fight", allow: true, next: true }] as Item;
    expect(nodes(compiled(text, grant, other), (node) => node.type === "permission")).toHaveLength(2);
    const stopped = "Your unit is eligible to fight even if it has fought. It must be selected to fight next.";
    expect(nodes(compiled(stopped, grant, ["It must be selected to fight next", "eligibility-permission", { subject: "this-unit", activity: "fight", allow: true, next: true }]), (node) => node.type === "permission")).toHaveLength(2);
    expect(foldFightNext(placed(stopped, grant, ["must be selected to fight next", "eligibility-permission", { subject: "this-unit", activity: "fight", allow: true, next: true }]), stopped)).toHaveLength(2);
  });

  it("leaves a bare next leaf with no fight permission before it as a permission of its own", () => {
    const alone = "Your unit has the first strike ability and must be selected to fight next.";
    const mechanics = compiled(alone,
      ["has the first strike ability", "fights-first", { subject: "this-unit" }],
      ["must be selected to fight next", "eligibility-permission", { subject: "this-unit", activity: "fight", allow: true, next: true }]);
    expect(nodes(mechanics, (node) => node.type === "permission").map((node) => node.modifier)).toEqual([{ activity: "fight", allow: true, next: true }]);
  });

  it("does not fold a leaf that carries more than the bare next", () => {
    const rich = ["must be selected to fight next", "eligibility-permission", { subject: "this-unit", activity: "fight", allow: true, next: true, despite: ["fought-this-phase"] }] as Item;
    expect(foldFightNext(placed(text, grant, rich), text)).toHaveLength(2);
  });
});

describe("no-advance-roll names the unit a move-ended event names", () => {
  const text = "Each time a SQUADRON unit Advances, do not make an Advance roll for it. Add 6 to its Move.";
  const event: Item = ["a SQUADRON unit Advances", "event", { kind: "move-ended", owner: "friendly", move_types: ["advance"] }];
  const bonus: Item = ["Add 6 to its Move", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "add", value: 6 }];

  it("accepts event-subject at the new version and not before", () => {
    expect(normalize("no-advance-roll", { subject: "event-subject" })).toEqual({ subject: "event-subject" });
    expect(() => normalize("no-advance-roll", { subject: "event-subject" }, PREVIOUS("no-advance-roll"))).toThrow();
    for (const subject of ["this-unit", "this-model", "antecedent"]) {
      expect(normalize("no-advance-roll", { subject }, PREVIOUS("no-advance-roll"))).toEqual(normalize("no-advance-roll", { subject }));
    }
  });

  it("folds a later add-6 into a no-roll on the event's unit", () => {
    const mechanics = compiled(text, event, ["do not make an Advance roll for it", "no-advance-roll", { subject: "event-subject" }], bonus);
    const moves = nodes(mechanics, (node) => node.type === "move-modifier" && node.modifier?.advance === "fixed-6");
    expect(moves).toHaveLength(1);
    expect(moves[0]!.target).toBe("event-subject");
  });

  it("carries the cannot-end tail onto the event's unit, scoped to Advance moves", () => {
    const tail = "Each time a SQUADRON unit Advances, do not make an Advance roll for it. Add 6 to its Move, and it can move through enemy models, but it cannot end that move within Engagement Range of enemy models.";
    const mechanics = compiled(tail, event,
      ["do not make an Advance roll for it", "no-advance-roll", { subject: "event-subject" }],
      ["Add 6 to its Move", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "add", value: 6 }],
      ["and it can move through enemy models", "eligibility-permission", { subject: "event-subject", activity: "move", allow: true, despite: ["engaged"] }],
      ["cannot end that move", "move-must-end", { match: "all", polarity: "cannot" }],
      ["within Engagement Range of enemy models", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false }]);
    const ends = nodes(mechanics, (node) => node.type === "move-modifier" && node.modifier?.no_end_in_engagement === true);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.target).toBe("event-subject");
    expect(ends[0]!.modifier.applies_to_moves).toEqual(["advance"]);
  });

  it("still refuses an add-6 beside a no-roll on a different unit", () => {
    expect(refused(text, event, ["do not make an Advance roll for it", "no-advance-roll", { subject: "this-unit" }], bonus)).toMatch(/folds only for the same unit/u);
  });
});

describe("a hypothetical phase on an eligible test", () => {
  const text = "One ALPHA unit that would be eligible to declare a charge if it were your Charge phase. Until the end of the turn, that unit can shoot.";
  const items = (eligible: Record<string, unknown>, window: Record<string, unknown>): Item[] => [
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["would be eligible to declare a charge", "eligible", { subject: "antecedent", to: "declare-charge", ...eligible }, "TARGET"],
    ["if it were your Charge phase", "phase-window", { phase: "charge", turn: "your", ...window }, "TARGET"],
    ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }, "EFFECT"],
    ["that unit can shoot", "eligibility-permission", { subject: "antecedent", activity: "shoot", allow: true }, "EFFECT"],
  ];
  const fold = (eligible: Record<string, unknown>, window: Record<string, unknown>, source = text) => foldAsIfPhases(placed(source, ...items(eligible, window)), source);

  it("absorbs the phase into the eligible test when it matches the activity", () => {
    const folded = fold({}, {});
    expect(folded.some((leaf) => leaf.family_id === "phase-window")).toBe(false);
    expect(folded.some((leaf) => leaf.family_id === "eligible")).toBe(true);
  });

  it("absorbs shooting and fight phases for their own activities", () => {
    for (const [to, phase, word] of [["shoot", "shooting", "Shooting"], ["fight", "fight", "Fight"]] as const) {
      const source = `One ALPHA unit that would be eligible to act if it were your ${word} phase.`;
      const folded = foldAsIfPhases(placed(source,
        ["would be eligible to act", "eligible", { subject: "antecedent", to }, "TARGET"],
        [`if it were your ${word} phase`, "phase-window", { phase, turn: "your" }, "TARGET"]), source);
      expect(folded.map((leaf) => leaf.family_id)).toEqual(["eligible"]);
    }
  });

  it("refuses a phase that does not match the eligible activity", () => {
    expect(() => fold({ to: "shoot" }, {})).toThrow(/names the charge phase, but the eligible condition/u);
  });

  it("refuses a negated or timed eligible test", () => {
    expect(() => fold({ negated: true }, {})).toThrow(/negated or timed/u);
    expect(() => fold({ at: "opponents-previous-turn-end" }, {})).toThrow(/negated or timed/u);
  });

  it("refuses a turn other than your own", () => {
    expect(() => fold({}, { turn: "opponent" })).toThrow(/only turn: your folds/u);
    expect(() => fold({}, { turn: "either" })).toThrow(/only turn: your folds/u);
  });

  it("keeps the old refusal with no permission or eligible test before the window, or a sentence stop between", () => {
    const bare = "Your unit is selected if it were your Charge phase.";
    expect(() => foldAsIfPhases(placed(bare, ["if it were your Charge phase", "phase-window", { phase: "charge", turn: "your" }, "TARGET"]), bare)).toThrow(/no permission before it in its sentence/u);
    const stopped = "A unit would be eligible to declare a charge. If it were your Charge phase, it acts.";
    expect(() => foldAsIfPhases(placed(stopped,
      ["would be eligible to declare a charge", "eligible", { subject: "antecedent", to: "declare-charge" }, "TARGET"],
      ["If it were your Charge phase", "phase-window", { phase: "charge", turn: "your" }, "TARGET"]), stopped)).toThrow(/no permission before it in its sentence/u);
  });

  it("compiles with no phase gate", () => {
    const mechanics = compiled(text, ...items({}, {}));
    expect(nodes(mechanics, (node) => node.type === "phase")).toEqual([]);
  });
});

describe("a While frame reaches the later moment sentences that say that unit", () => {
  const leading = { subject: "this-model", attachment: "leading" };
  const frame = (text: string, ...rest: Item[]) => sentenceSegments(placed(text,
    ["While this model is leading a unit", "leading-unit", leading],
    ["models in that unit can move far", "make-move", { subject: "this-unit", move_type: "normal" }],
    ...rest), text);
  const hasFrame = (part: CompileLeaf[]) => part.filter((leaf) => leaf.family_id === "leading-unit").length;

  it("copies the leading-unit condition into a later part that opens its own moment", () => {
    const text = "While this model is leading a unit, models in that unit can move far. When it ends, add 1 to the Hit roll of models in that unit.";
    const parts = frame(text, ["add 1 to the Hit roll of models in that unit", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])!;
    expect(parts).toHaveLength(2);
    expect(parts.map(hasFrame)).toEqual([1, 1]);
    expect(parts[1]![0]!.family_id).toBe("leading-unit");
  });

  it("copies nothing into a later part that never says that unit", () => {
    const text = "While this model is leading a unit, models in that unit can move far. When it ends, add 1 to the Hit roll.";
    const parts = frame(text, ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])!;
    expect(parts.map(hasFrame)).toEqual([1, 0]);
  });

  it("does not copy it into a part that opens with \"In addition,\"", () => {
    const text = "While this model is leading a unit, models in that unit can move far. In addition, when it ends, add 1 to the Hit roll.";
    const parts = frame(text, ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])!;
    expect(parts.map(hasFrame)).toEqual([1, 0]);
  });

  it("does not duplicate a leading-unit leaf the later part states itself", () => {
    const text = "While this model is leading a unit, models in that unit can move far. When it ends, while this model is leading a unit, add 1 to the Hit roll.";
    const parts = frame(text,
      ["while this model is leading a unit", "leading-unit", leading],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])!;
    expect(parts.map(hasFrame)).toEqual([1, 1]);
  });

  it("copies nothing when the first sentence does not open with \"While\"", () => {
    const text = "If this model is leading a unit, models in that unit can move far. When it ends, add 1 to the Hit roll.";
    const list = placed(text,
      ["If this model is leading a unit", "leading-unit", leading],
      ["models in that unit can move far", "make-move", { subject: "this-unit", move_type: "normal" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(sentenceSegments(list, text)!.map(hasFrame)).toEqual([1, 0]);
  });

  it("copies only leading-unit, not another condition of the first sentence", () => {
    const text = "While this model is leading a unit and is battle-shocked, models in that unit can move far. When it ends, add 1 to the Hit roll of models in that unit.";
    const list = placed(text,
      ["While this model is leading a unit", "leading-unit", leading],
      ["is battle-shocked", "unit-state", { subject: "this-unit", states: ["battle-shocked"], negated: false }],
      ["models in that unit can move far", "make-move", { subject: "this-unit", move_type: "normal" }],
      ["add 1 to the Hit roll of models in that unit", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    const parts = sentenceSegments(list, text)!;
    expect(parts[1]!.map((leaf) => leaf.family_id)).toEqual(["leading-unit", "roll-modifier"]);
  });

  it("reads the part's own opening sentence, not a header sentence before it", () => {
    // The header sentence opens with "In addition,"; the later part does not, so it still inherits.
    const text = "In addition, ALPHA model only. While this model is leading a unit, models in that unit can move far. When it ends, add 1 to the Hit roll of models in that unit.";
    const list = placed(text,
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["While this model is leading a unit", "leading-unit", leading],
      ["models in that unit can move far", "make-move", { subject: "this-unit", move_type: "normal" }],
      ["add 1 to the Hit roll of models in that unit", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    const parts = sentenceSegments(list, text);
    expect(parts).not.toBeNull();
    expect(parts![1]!.filter((leaf) => leaf.family_id === "leading-unit")).toHaveLength(1);
  });
});

describe("a While frame gates a later move-scoped part end to end", () => {
  it("puts the second sentence's permission and cannot-end under the leading condition", () => {
    const text = "While this model is leading a unit, models in that unit can move through terrain. When making a Normal move, models in that unit can move through enemy models but cannot end that move within Engagement Range.";
    const mechanics = compiled(text,
      ["While this model is leading a unit", "leading-unit", { subject: "this-model", attachment: "leading" }],
      ["models in that unit can move through terrain", "move-through", { subject: "this-unit", passthrough: ["all-terrain", "models"], applies_to_moves: ["normal", "advance", "fall-back"] }],
      ["When making a Normal move", "event", { kind: "selected", move_types: ["normal"], subject: "this-unit" }],
      ["models in that unit can move through enemy models", "eligibility-permission", { subject: "this-unit", activity: "move", allow: true, despite: ["engaged"] }],
      ["cannot end that move", "move-must-end", { match: "all", polarity: "cannot" }],
      ["within Engagement Range", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false }]);
    const parts = nodes(mechanics, (node) => node.type === "ability-part");
    expect(parts).toHaveLength(1);
    // The second sentence's own part sits inside the leading condition, and its cannot-end is scoped to Normal moves.
    expect(JSON.stringify(parts[0])).toContain('"role":"leading"');
    expect(nodes(parts[0], (node) => node.type === "move-modifier" && node.modifier?.no_end_in_engagement === true)[0]!.modifier.applies_to_moves).toEqual(["normal"]);
  });
});
