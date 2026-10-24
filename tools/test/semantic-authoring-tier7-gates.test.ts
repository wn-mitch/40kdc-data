import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { foldPassthroughUsed } from "../src/semantic-authoring/compile-passthrough-used.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { ROLL_KINDS } from "../src/semantic-authoring/dice-families.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { unresolvedOfAbilityRolls } from "../src/integrity-of-ability-roll.js";
import { describeTrigger } from "../src/translate/trigger.js";

// Fabricated wording only. Each shape keeps the sentence structure of a tier-7 record with invented words.

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves at the byte offsets of their wording in `text`, in order, at each family's current version. */
function placed(text: string, items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment = "RAW_TEXT"]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = start + Buffer.byteLength(wording, "utf8");
    from = end;
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: end, fragment };
  });
}

function compiled(text: string, items: Item[]) {
  const result = compileLeaves(placed(text, items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base, result.mechanics));
  expect(check.errors).toEqual([]);
  return result.mechanics as unknown as Record<string, any>;
}

function refusal(text: string, items: Item[]): string {
  const result = compileLeaves(placed(text, items), text);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join(" ");
}

// "if it does" after a tall-terrain move-through: the follow-up moment is gated by the move that used it.
const TALL = "Each time this model makes a Normal move, it can move through models. It can also move through tall ridges, but if it does, after it has moved, roll one D6: on a 1, this model is Battle-shocked.";
const ENDED = ["Each time this model makes a Normal move", "event", { kind: "move-ended", subject: "this-model", move_types: ["normal"] }] as Item;
const MODELS = ["it can move through models", "move-through", { subject: "this-model", passthrough: "non-titanic-models", applies_to_moves: ["normal"] }] as Item;
const TALL_MOVE = ["It can also move through tall ridges", "move-through", { subject: "antecedent", passthrough: "tall-terrain" }] as Item;
const QUALIFIER = ["but if it does", "move-passthrough-used", { passthrough: "tall-terrain" }] as Item;
const AFTER = ["after it has moved", "event", { kind: "move-ended", subject: "antecedent" }] as Item;
const ROLL: Item[] = [["roll one D6", "dice-roll", { dice: "D6" }], ["on a 1", "roll-result", { from: 1, to: 1 }], ["this model is Battle-shocked", "battle-shock-state", { recipient: "this-unit", set: true }]];

// "Do not roll to gain a Blood Tithe point" after a melee destruction: the prohibited roll is the ability's own.
const BLOOD = "Each time the bearer's unit destroys an enemy unit with a melee attack, do not roll to gain a Blood Tithe point, you automatically gain 1 Blood Tithe point instead.";
const DESTROYED: Item = ["Each time the bearer's unit destroys an enemy unit", "event", { kind: "unit-destroyed", by: "this-unit", object_owner: "enemy" }];
const MELEE: Item = ["with a melee attack", "attack-filter", { attack_type: "melee" }];
const PROHIBIT: Item = ["do not roll to gain a Blood Tithe point,", "roll-prohibition", { roll: { ability: "blood-tithe-world-eaters" } }];
const GAIN: Item = ["you automatically gain 1 Blood Tithe point", "resource-gain", { pool: "blood-tithe-pool", amount: 1 }];
const INSTEAD: Item = ["instead", "instead", {}, "EFFECT"];

/** The compiled trigger of the ability part whose trigger carries the through filter. */
function throughStep(mechanics: Record<string, any>) {
  const steps = mechanics.effect.steps as Array<Record<string, any>>;
  return steps.find((step) => step.trigger?.filter?.through !== undefined);
}

describe("the move-passthrough-used family", () => {
  it("is a CONDITION that takes only the tall-terrain token", () => {
    expect(familyRole("move-passthrough-used")).toBe("CONDITION");
    expect(normalizeFingerprintParameters("move-passthrough-used", { passthrough: "tall-terrain" }, currentFamilyVersion("move-passthrough-used")))
      .toEqual({ passthrough: "tall-terrain" });
  });

  it("refuses the broader terrain tokens, an unknown key and a missing token", () => {
    const version = currentFamilyVersion("move-passthrough-used");
    for (const passthrough of ["terrain", "all-terrain", "terrain-le-4", "non-titanic-models"]) {
      expect(() => normalizeFingerprintParameters("move-passthrough-used", { passthrough }, version)).toThrow();
    }
    expect(() => normalizeFingerprintParameters("move-passthrough-used", { passthrough: "tall-terrain", subject: "this-model" }, version)).toThrow();
    expect(() => normalizeFingerprintParameters("move-passthrough-used", {}, version)).toThrow();
  });
});

describe("event@23 through (move-ended only)", () => {
  const version = currentFamilyVersion("event");
  const sampled: Array<Record<string, unknown>> = [
    { kind: "move-ended", move_types: ["normal"] },
    { kind: "move-ended", subject: "this-model", move_types: ["normal"] },
    { kind: "move-ended", owner: "friendly", move_types: ["normal", "advance"] },
    { kind: "move-ended", subject: "antecedent" },
  ];

  it("accepts every event the previous version accepted, unchanged", () => {
    expect(version).toBe(currentFamilyVersion("event"));
    for (const parameters of sampled) {
      expect(normalizeFingerprintParameters("event", parameters, version)).toEqual(normalizeFingerprintParameters("event", parameters, version - 1));
    }
  });

  it("takes through on a move-ended moment, and only the tall-terrain value", () => {
    const withThrough = normalizeFingerprintParameters("event", { kind: "move-ended", subject: "this-model", move_types: ["normal"], through: "tall-terrain" }, version);
    expect(withThrough).toEqual({ kind: "move-ended", subject: "this-model", move_types: ["normal"], through: "tall-terrain" });
    expect(() => normalizeFingerprintParameters("event", { kind: "move-ended", through: "terrain" }, version)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "move-ended", through: "all-terrain" }, version)).toThrow();
  });

  it("refuses through on any other moment kind", () => {
    expect(() => normalizeFingerprintParameters("event", { kind: "selected", subject: "selected-unit", through: "tall-terrain" }, version)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "unit-destroyed", through: "tall-terrain" }, version)).toThrow();
  });
});

describe("roll-prohibition@2 (a named ability's own roll)", () => {
  it("accepts every roll the previous version accepted, unchanged", () => {
    expect(currentFamilyVersion("roll-prohibition")).toBe(2);
    for (const roll of ROLL_KINDS) {
      expect(normalizeFingerprintParameters("roll-prohibition", { roll }, 2)).toEqual(normalizeFingerprintParameters("roll-prohibition", { roll }, 1));
    }
  });

  it("takes {ability: id} as the roll, and refuses a malformed id or an extra key", () => {
    expect(normalizeFingerprintParameters("roll-prohibition", { roll: { ability: "blood-tithe-world-eaters" } }, 2))
      .toEqual({ roll: { ability: "blood-tithe-world-eaters" } });
    expect(() => normalizeFingerprintParameters("roll-prohibition", { roll: { ability: "Bad Id" } }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("roll-prohibition", { roll: { ability: "x-y", extra: 1 } }, 2)).toThrow();
  });
});

describe("foldPassthroughUsed and the through gate", () => {
  it("gates the move-ended moment after the qualifier on the bearer's tall-terrain move, and the roll follows it", () => {
    const mechanics = compiled(TALL, [ENDED, MODELS, TALL_MOVE, QUALIFIER, AFTER, ...ROLL]);
    const step = throughStep(mechanics)!;
    expect(step.trigger).toEqual({ event: "move-ended", subject: "this-model", filter: { through: "tall-terrain" } });
    expect(step.effect.type).toBe("dice-table");
    expect(describeTrigger(step.trigger)).toContain('moves through terrain over 4" tall');
  });

  it("gates only the moment after the tall-terrain move when the move-throughs before it are split by terrain", () => {
    // Two move-throughs precede the tall one (a non-titanic permission and a 4-inch terrain permission). The
    // qualifier names the nearest move-through, the tall move, so the gate lands on that move's moment alone.
    const split = "Each time this model makes a Normal move, it can move through models and sections of terrain features that are 4\" or less in height. It can also move through tall ridges, but if it does, after it has moved, roll one D6: on a 1, this model is Battle-shocked.";
    const mechanics = compiled(split, [
      ENDED,
      ["it can move through models", "move-through", { subject: "this-model", passthrough: "non-titanic-models", applies_to_moves: ["normal"] }],
      ["sections of terrain features that are 4\" or less in height", "move-through", { subject: "this-model", passthrough: "terrain-le-4", applies_to_moves: ["normal"] }],
      TALL_MOVE,
      QUALIFIER,
      AFTER,
      ...ROLL,
    ]);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps.filter((step) => step.trigger?.filter?.through !== undefined)).toHaveLength(1);
    expect(throughStep(mechanics)!.trigger).toEqual({ event: "move-ended", subject: "this-model", filter: { through: "tall-terrain" } });
    expect(JSON.stringify(steps[0])).toContain("terrain-le-4");
  });

  it("does not mutate the leaves it folds", () => {
    // The permission names its mover, as bindAntecedents leaves it.
    const named: Item = ["after it has moved", "event", { kind: "move-ended", subject: "this-model" }];
    const leaves = placed(TALL, [ENDED, MODELS, ["It can also move through tall ridges", "move-through", { subject: "this-model", passthrough: "tall-terrain" }], QUALIFIER, named, ...ROLL]);
    const before = JSON.stringify(leaves);
    foldPassthroughUsed(leaves);
    expect(JSON.stringify(leaves)).toBe(before);
  });

  it("refuses a qualifier with no move-ended moment after it in its fragment", () => {
    expect(refusal(TALL, [ENDED, MODELS, TALL_MOVE, QUALIFIER, ...ROLL])).toContain("names a move-ended moment, but no move-ended moment follows it");
  });

  it("refuses a qualifier whose nearest move-through passes through other terrain", () => {
    const other: Item = ["It can also move through tall ridges", "move-through", { subject: "antecedent", passthrough: "non-titanic-models" }];
    expect(refusal(TALL, [ENDED, MODELS, other, QUALIFIER, AFTER, ...ROLL])).toContain('passes through "non-titanic-models"');
  });

  it("refuses a qualifier with no move-through before it", () => {
    expect(refusal(TALL, [ENDED, QUALIFIER, AFTER, ...ROLL])).toContain("none before it in its fragment moves through tall terrain");
  });

  it("refuses a moment that already carries a through", () => {
    const named: Item = ["after it has moved", "event", { kind: "move-ended", subject: "antecedent", through: "tall-terrain" }];
    expect(refusal(TALL, [ENDED, MODELS, TALL_MOVE, QUALIFIER, named, ...ROLL])).toContain("Conflicting through");
  });

  it("refuses a moment made by another unit than the permission's mover", () => {
    const named: Item = ["after it has moved", "event", { kind: "move-ended", subject: "this-unit" }];
    expect(refusal(TALL, [ENDED, MODELS, TALL_MOVE, QUALIFIER, named, ...ROLL])).toContain("names the move of this-model");
  });

  it("refuses a permission whose mover is a moment named by owner (the first moment of the live 2301 leaves)", () => {
    const owned: Item = ["Each time this model makes a Normal move", "event", { kind: "move-ended", owner: "friendly", move_types: ["normal"] }];
    expect(refusal(TALL, [owned, MODELS, TALL_MOVE, QUALIFIER, AFTER, ...ROLL])).toContain("needs the move before it to be made by this-unit or this-model");
  });

  it("refuses a current-leaf shape with the qualifier uncovered, rather than rolling ungated", () => {
    const ungated: Item[] = [["Each time this model makes a Normal move", "event", { kind: "move-ended", move_types: ["normal"] }], MODELS, TALL_MOVE, ...ROLL];
    expect(refusal(TALL, ungated)).toContain("but if it does");
  });
});

describe("a roll prohibition of a named ability's own roll", () => {
  it("compiles to one bearer-unit roll-result pass on that roll, with no gain beside it", () => {
    const mechanics = compiled(BLOOD, [DESTROYED, MELEE, PROHIBIT, GAIN, INSTEAD]);
    const text = JSON.stringify(mechanics.effect);
    expect(mechanics.effect.type).toBe("conditional");
    expect(mechanics.effect.effect).toEqual({ type: "roll-result", target: "this-unit", modifier: { roll: { of_ability: "blood-tithe-world-eaters" }, result: "pass" } });
    expect(text).not.toContain("resource-gain");
    expect(text).not.toContain("roll-prohibition");
  });

  it("refuses a gain of another pool, or of another amount, than the roll pays out", () => {
    const pool: Item = ["you automatically gain 1 Blood Tithe point", "resource-gain", { pool: "command-point", amount: 1 }];
    expect(refusal(BLOOD, [DESTROYED, MELEE, PROHIBIT, pool, INSTEAD])).toContain("gains only 1 point of blood-tithe-pool");
    const amount: Item = ["you automatically gain 1 Blood Tithe point", "resource-gain", { pool: "blood-tithe-pool", amount: 2 }];
    expect(refusal(BLOOD, [DESTROYED, MELEE, PROHIBIT, amount, INSTEAD])).toContain("gains only 1 point of blood-tithe-pool");
  });

  it("refuses a kind roll replaced by a gain, in its own sentence or its clause (the one-effect refusal)", () => {
    const text = "Do not roll hit. Gain 1 Blood Tithe point instead.";
    const items: Item[] = [["Do not roll hit.", "roll-prohibition", { roll: "hit" }], ["Gain 1 Blood Tithe point", "resource-gain", { pool: "blood-tithe-pool", amount: 1 }], ["instead", "instead", {}, "EFFECT"]];
    expect(refusal(text, items)).toContain('"Instead" needs exactly one effect in its clause; found 2.');
  });

  it("keeps the one-effect refusal for a kind roll sharing its clause with a gain", () => {
    const text = "Each time the bearer's unit destroys an enemy unit with a melee attack, do not roll hit, you automatically gain 1 Blood Tithe point instead.";
    const shared: Item[] = [["do not roll hit,", "roll-prohibition", { roll: "hit" }], GAIN, INSTEAD];
    expect(refusal(text, [DESTROYED, MELEE, ...shared])).toContain('"Instead" needs exactly one effect in its clause; found 2.');
  });
});

describe("the of_ability reference check", () => {
  const ability = (id: string) => ({ ability_id: "x", effect: { type: "conditional", effect: { type: "roll-result", modifier: { roll: { of_ability: id }, result: "pass" } } } });

  it("names each record whose of_ability resolves to no known ability id", () => {
    const known = new Set(["blood-tithe-world-eaters"]);
    expect(unresolvedOfAbilityRolls([ability("blood-tithe-world-eaters"), ability("no-such-ability")], known)).toEqual([{ index: 1, id: "no-such-ability" }]);
  });

  it("finds no reference in a record that rolls no named ability's dice", () => {
    expect(unresolvedOfAbilityRolls([{ effect: { type: "dice-roll", modifier: { roll: "hit" } } }], new Set())).toEqual([]);
  });
});
