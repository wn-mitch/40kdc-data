import { describe, expect, it } from "vitest";

import { CompileError } from "../src/semantic-authoring/compile-fragments.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { foldCountsAsMoved } from "../src/semantic-authoring/compile-counts-as-moved.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves placed on their wording in `text`, in order (fabricated wording, not rules text). */
function build(text: string, ...items: Item[]): CompileLeaf[] {
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

const DISEMBARK = { subject: "selected-unit", activity: "disembark", allow: true };
const MOVE_ENDED = { kind: "move-ended" };
const COUNTS = { move_type: "normal" };

describe("the counts-as-moved family", () => {
  it("is a CONDITION at version 1", () => {
    expect(currentFamilyVersion("counts-as-moved")).toBe(1);
    expect(familyRole("counts-as-moved")).toBe("CONDITION");
  });

  it("accepts a normal move, with or without the phase window", () => {
    expect(normalizeFingerprintParameters("counts-as-moved", { move_type: "normal" })).toEqual({ move_type: "normal" });
    expect(normalizeFingerprintParameters("counts-as-moved", { move_type: "normal", window: "phase" })).toEqual({ move_type: "normal", window: "phase" });
  });

  it("refuses another move kind, a turn window, an unknown key, and a missing move kind", () => {
    expect(() => normalizeFingerprintParameters("counts-as-moved", { move_type: "advance" })).toThrow();
    expect(() => normalizeFingerprintParameters("counts-as-moved", { move_type: "normal", window: "turn" })).toThrow();
    expect(() => normalizeFingerprintParameters("counts-as-moved", { move_type: "normal", subject: "this-unit" })).toThrow();
    expect(() => normalizeFingerprintParameters("counts-as-moved", { window: "phase" })).toThrow();
  });
});

describe("foldCountsAsMoved", () => {
  const text = "Fabricated transport. It can disembark from it. After that, it has moved. Carried units that do so count as having made a Test move.";
  const sentenceSplit: Item[] = [
    ["It can disembark from it.", "eligibility-permission", DISEMBARK],
    ["After that, it has moved.", "event", MOVE_ENDED],
    ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS],
  ];

  it("binds across a sentence boundary when one move-ended event lies between, and drops the counts-as leaf", () => {
    const folded = foldCountsAsMoved(build(text, ...sentenceSplit), text);
    expect(folded.map((leaf) => leaf.family_id)).toEqual(["eligibility-permission", "event"]);
    expect(folded[0]!.parameters.counts_as_move).toBe("normal");
  });

  it("refuses a phase window as a DSL_GAP, since the DSL has no counts_as_until", () => {
    const phaseText = "Fabricated transport. It can disembark from it. After that, it has moved. Carried units that do so count as having made a Test move that phase.";
    expect(() => foldCountsAsMoved(build(phaseText,
      ["It can disembark from it.", "eligibility-permission", DISEMBARK],
      ["After that, it has moved.", "event", MOVE_ENDED],
      ["Carried units that do so count as having made a Test move that phase.", "counts-as-moved", { move_type: "normal", window: "phase" }]), phaseText))
      .toThrow(/DSL_GAP.*counts_as_until/);
  });

  it("refuses a permission for an activity other than disembark, as a DSL_GAP", () => {
    const shoot = build(text,
      ["It can disembark from it.", "eligibility-permission", { ...DISEMBARK, activity: "shoot" }],
      ["After that, it has moved.", "event", MOVE_ENDED],
      ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS]);
    expect(() => foldCountsAsMoved(shoot, text)).toThrow(/DSL_GAP.*shoot/);
  });

  it("refuses with no permission before it, and does not reach into another fragment for one", () => {
    const none = build(text, ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS]);
    expect(() => foldCountsAsMoved(none, text)).toThrow(/no permission before it in its fragment/);
    const other = build(text,
      ["It can disembark from it.", "eligibility-permission", DISEMBARK, "FRAGMENT_A"],
      ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS, "FRAGMENT_B"]);
    expect(() => foldCountsAsMoved(other, text)).toThrow(/no permission before it in its fragment/);
  });

  it("refuses a permission that forbids the activity", () => {
    const forbid = build(text,
      ["It can disembark from it.", "eligibility-permission", { ...DISEMBARK, allow: false }],
      ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS]);
    expect(() => foldCountsAsMoved(forbid, text)).toThrow(/forbids the activity/);
  });

  it("refuses a permission that already counts as a move", () => {
    const again = build(text,
      ["It can disembark from it.", "eligibility-permission", { ...DISEMBARK, counts_as_move: "normal" }],
      ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS]);
    expect(() => foldCountsAsMoved(again, text)).toThrow(/Conflicting counts-as/);
  });

  it("refuses an intervening permission from another fragment, which the nearest-permission search skips", () => {
    const between = build(text,
      ["It can disembark from it.", "eligibility-permission", DISEMBARK, "FRAGMENT_A"],
      ["After that, it has moved.", "eligibility-permission", { subject: "this-model", activity: "shoot", allow: true }, "FRAGMENT_B"],
      ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS, "FRAGMENT_A"]);
    expect(() => foldCountsAsMoved(between, text)).toThrow(/leaves other than one move-ended event/);
  });

  it("refuses an intervening make-move, which is not a move-ended event", () => {
    const moved = build(text,
      ["It can disembark from it.", "eligibility-permission", DISEMBARK],
      ["After that, it has moved.", "make-move", { subject: "this-unit", move_type: "normal" }],
      ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS]);
    expect(() => foldCountsAsMoved(moved, text)).toThrow(/leaves other than one move-ended event/);
  });

  it("refuses two move-ended events between the permission and the counts-as leaf", () => {
    const twice = "Fabricated transport. It can disembark from it. After that, it has moved. Then it has moved again. Carried units that do so count as having made a Test move.";
    const leaves = build(twice,
      ["It can disembark from it.", "eligibility-permission", DISEMBARK],
      ["After that, it has moved.", "event", MOVE_ENDED],
      ["Then it has moved again.", "event", MOVE_ENDED],
      ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS]);
    expect(() => foldCountsAsMoved(leaves, twice)).toThrow(/leaves other than one move-ended event/);
  });

  it("refuses a this-unit permission as a DSL_GAP: the DSL cannot name the disembarking units", () => {
    const self = build(text,
      ["It can disembark from it.", "eligibility-permission", { ...DISEMBARK, subject: "this-unit" }],
      ["After that, it has moved.", "event", MOVE_ENDED],
      ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS]);
    expect(() => foldCountsAsMoved(self, text)).toThrow(/DSL_GAP.*cannot name them/);
    const result = compileLeaves(self, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/DSL_GAP/);
    expect(result.ok ? "" : result.errors.join(" ")).not.toMatch(/only does ranges/);
  });

  it("refuses a charge refusal in the same sentence as the counts-as leaf, as a DSL_GAP", () => {
    const same = "Fabricated transport. It can disembark from it. After that, it has moved. Carried units that do so count as having made a Test move, and cannot declare a Test charge.";
    const leaves = build(same,
      ["It can disembark from it.", "eligibility-permission", DISEMBARK],
      ["After that, it has moved.", "event", MOVE_ENDED],
      ["Carried units that do so count as having made a Test move", "counts-as-moved", COUNTS],
      ["cannot declare a Test charge", "eligibility-permission", { subject: "selected-unit", activity: "declare-charge", allow: false }]);
    expect(() => foldCountsAsMoved(leaves, same)).toThrow(/DSL_GAP.*charge refusal/);
  });

  it("does not refuse a charge refusal that opens the next sentence", () => {
    const next = "Fabricated transport. It can disembark from it. After that, it has moved. Carried units that do so count as having made a Test move. They cannot declare a Test charge.";
    const leaves = build(next,
      ["It can disembark from it.", "eligibility-permission", DISEMBARK],
      ["After that, it has moved.", "event", MOVE_ENDED],
      ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS],
      ["They cannot declare a Test charge.", "eligibility-permission", { subject: "selected-unit", activity: "declare-charge", allow: false }]);
    const folded = foldCountsAsMoved(leaves, next);
    expect(folded.map((leaf) => leaf.family_id)).toEqual(["eligibility-permission", "event", "eligibility-permission"]);
    expect(folded[0]!.parameters.counts_as_move).toBe("normal");
  });

  it("returns the leaves unchanged when none is a counts-as-moved leaf, and refuses without source text", () => {
    const plain = build(text, ["It can disembark from it.", "eligibility-permission", DISEMBARK]);
    expect(foldCountsAsMoved(plain, undefined)).toEqual(plain);
    const leaves = build(text, ["Carried units that do so count as having made a Test move.", "counts-as-moved", COUNTS]);
    expect(() => foldCountsAsMoved(leaves, undefined)).toThrow(/needs the source text/);
  });
});

describe("a folded counts-as-moved permission through compileLeaves", () => {
  const text = "Fabricated transport. It can disembark from it. After that, it has moved. Carried units that do so count as having made a Test move.";

  it("carries counts_as_move into the permission's modifier", () => {
    // The fold's output permission, compiled alone: the copy does not depend on the subject.
    const result = compileLeaves(build("Fabricated transport. It can disembark from it.",
      ["It can disembark from it.", "eligibility-permission", { subject: "this-unit", activity: "disembark", allow: true, counts_as_move: "normal" }]),
      "Fabricated transport. It can disembark from it.");
    expect(result.ok, result.ok ? "" : result.errors.join(" | ")).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain('"counts_as_move":"normal"');
  });

  it("the DSL schema accepts a permission with counts_as_move normal and refuses an unknown move kind", () => {
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
    const permission = (counts_as_move: string) => ({ type: "permission", target: "this-unit", modifier: { activity: "disembark", allow: true, counts_as_move } });
    expect(validate(permission("normal"))).toBe(true);
    expect(validate(permission("walk"))).toBe(false);
  });
});

describe("the seven record shapes after SS-0 authoring", () => {
  // Leaf layouts of the seven records (design section 2, SS-0): the trigger, the disembark
  // permission on this-unit, the move-ended event, the counts-as leaf with its window, the charge
  // refusal narrowed to its own clause, and each printed duration as its own leaf. Wording is fabricated.
  const TRANSPORT = { subject: "this-unit", activity: "disembark", allow: true, despite: ["advanced"] };
  const CHARGE_REFUSAL = { subject: "this-unit", activity: "declare-charge", allow: false };
  const END_OF_TURN = { endpoint: "end-of-turn" };
  const MOVE_ENDED = { kind: "move-ended", move_types: ["advance"] };
  const PHASE = { move_type: "normal", window: "phase" };
  const TURN = { move_type: "normal" };

  const SHAPES: Array<{ av: string; text: string; items: Item[]; reasons: RegExp[] }> = [
    {
      av: "16 (use-window trigger, this turn)",
      text: "Fabricated trigger. Carried units can disembark from it after it moved. Carried units that do so count as having made a Test move, and cannot declare a Test charge this turn.",
      items: [
        ["Fabricated trigger.", "event", MOVE_ENDED],
        ["Carried units can disembark from it", "eligibility-permission", TRANSPORT],
        ["Carried units that do so count as having made a Test move", "counts-as-moved", PHASE],
        ["cannot declare a Test charge", "eligibility-permission", CHARGE_REFUSAL],
        ["this turn", "duration", END_OF_TURN],
      ],
      reasons: [/counts_as_until/, /cannot name them/, /charge refusal/],
    },
    {
      av: "3377 (selected to Advance, that phase)",
      text: "Fabricated select. Carried units can disembark from this model after it moved. Carried units that do so count as having made a Test move that phase, and cannot declare a Test charge in the same turn, but can otherwise act normally.",
      items: [
        ["Carried units can disembark from this model", "eligibility-permission", TRANSPORT],
        ["after it moved", "event", MOVE_ENDED],
        ["Carried units that do so count as having made a Test move that phase", "counts-as-moved", PHASE],
        ["cannot declare a Test charge", "eligibility-permission", CHARGE_REFUSAL],
        ["in the same turn", "duration", END_OF_TURN],
      ],
      reasons: [/counts_as_until/, /cannot name them/, /charge refusal/],
    },
    {
      av: "7091 and 7228 (transport, that phase)",
      text: "Carried units can disembark from this transport after it moved. Carried units that do so count as having made a Test move that phase, and cannot declare a Test charge in the same turn, but can otherwise act normally.",
      items: [
        ["Carried units can disembark from this transport", "eligibility-permission", TRANSPORT],
        ["after it moved", "event", MOVE_ENDED],
        ["Carried units that do so count as having made a Test move that phase", "counts-as-moved", PHASE],
        ["cannot declare a Test charge", "eligibility-permission", CHARGE_REFUSAL],
        ["in the same turn", "duration", END_OF_TURN],
      ],
      reasons: [/counts_as_until/, /cannot name them/, /charge refusal/],
    },
    {
      av: "8845 and 9642 (transport, that phase, remainder duration)",
      text: "Carried units can disembark from this transport after it moved. Carried units that do so count as having made a Test move that phase, and cannot declare a Test charge in the same turn, but can otherwise act normally in the remainder of the turn.",
      items: [
        ["Carried units can disembark from this transport", "eligibility-permission", TRANSPORT],
        ["after it moved", "event", MOVE_ENDED],
        ["Carried units that do so count as having made a Test move that phase", "counts-as-moved", PHASE],
        ["cannot declare a Test charge", "eligibility-permission", CHARGE_REFUSAL],
        ["in the same turn", "duration", END_OF_TURN],
        ["in the remainder of the turn", "duration", END_OF_TURN],
      ],
      reasons: [/counts_as_until/, /cannot name them/, /charge refusal/],
    },
    {
      av: "8362 (no printed period, that turn)",
      text: "Carried units can disembark from this transport after it moved. Carried units that do so count as having made a Test move, and cannot declare a Test charge that turn.",
      items: [
        ["Carried units can disembark from this transport", "eligibility-permission", TRANSPORT],
        ["after it moved", "event", MOVE_ENDED],
        ["Carried units that do so count as having made a Test move", "counts-as-moved", TURN],
        ["cannot declare a Test charge", "eligibility-permission", CHARGE_REFUSAL],
        ["that turn", "duration", END_OF_TURN],
      ],
      reasons: [/cannot name them/, /charge refusal/],
    },
  ];

  for (const shape of SHAPES) {
    it(`gives each named DSL_GAP for av ${shape.av}, and never the old "only does ranges" refusal`, () => {
      const leaves = build(shape.text, ...shape.items);
      let thrown: unknown;
      try { foldCountsAsMoved(leaves, shape.text); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(CompileError);
      const message = (thrown as Error).message;
      expect(message).toMatch(/^DSL_GAP:/);
      for (const reason of shape.reasons) expect(message).toMatch(reason);
      expect(message).not.toMatch(/only does ranges/);
      // A row without a printed period has no counts_as_until reason (section 1.5).
      if (!shape.reasons.some((reason) => reason.source === "counts_as_until")) expect(message).not.toMatch(/counts_as_until/);

      const result = compileLeaves(leaves, shape.text);
      expect(result.ok).toBe(false);
      const errors = result.ok ? "" : result.errors.join(" | ");
      expect(errors).toMatch(/DSL_GAP/);
      expect(errors).not.toMatch(/only does ranges/);
    });
  }
});

describe("make-move output beside a counts-as-moved permission", () => {
  it("compiles a make-move with counts_as_move to the same move modifier, and without it to none", () => {
    const text = "Fabricated mover can make a Test move.";
    const withCounts = compileLeaves(build(text, ["Fabricated mover can make a Test move", "make-move", { subject: "this-unit", move_type: "normal", counts_as_move: "normal" }]), text);
    expect(withCounts.ok, withCounts.ok ? "" : withCounts.errors.join(" | ")).toBe(true);
    expect(withCounts.ok ? withCounts.mechanics.effect : null).toEqual({ type: "move", target: "this-unit", modifier: { move_type: "normal", counts_as_move: "normal" } });

    const without = compileLeaves(build(text, ["Fabricated mover can make a Test move", "make-move", { subject: "this-unit", move_type: "normal" }]), text);
    expect(without.ok, without.ok ? "" : without.errors.join(" | ")).toBe(true);
    expect(without.ok ? without.mechanics.effect : null).toEqual({ type: "move", target: "this-unit", modifier: { move_type: "normal" } });
  });
});
