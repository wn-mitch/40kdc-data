import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { coreCheckErrors } from "../src/round5c/core-checks.js";

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
const base = (): Record<string, unknown> => (JSON.parse(readFileSync(join(dataRoot, "enrichment", "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
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

const heal = (wording: string, subject = "antecedent"): [string, string, Record<string, unknown>] => [wording, "regain-wounds", { subject, amount: "1" }];
const usedAbility = (wording: string, extra: Record<string, unknown> = {}): [string, string, Record<string, unknown>] => [wording, "event", { kind: "used", activity: "ability", id: "foo-alpha", ...extra }];
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

describe("event used names the rule and who used it", () => {
  it("is a widening: a used leaf without the new keys normalizes as before", () => {
    expect(normalize("event", { kind: "used", activity: "order", owner: "friendly" })).toEqual({ kind: "used", activity: "order", owner: "friendly" });
    expect(normalize("event", { kind: "used", activity: "ability", id: "foo-alpha", subject: "this-model" })).toEqual({ kind: "used", activity: "ability", id: "foo-alpha", subject: "this-model" });
    expect(normalize("event", { kind: "after-roll", roll: "channelling", subject: "antecedent" })).toEqual({ kind: "after-roll", roll: "channelling", subject: "antecedent" });
  });

  it("refuses an id on a rule named only as a kind, a subject with an owner, and an id on other moments", () => {
    expect(() => normalize("event", { kind: "used", activity: "dark-pact", id: "foo-alpha" })).toThrow(/named only as a kind/u);
    expect(() => normalize("event", { kind: "used", activity: "ability", subject: "this-unit", owner: "enemy" })).toThrow(/subject or by owner/u);
    expect(() => normalize("event", { kind: "phase-start", phase: "command", turn: "your", id: "foo-alpha" })).toThrow();
    expect(() => normalize("event", { kind: "targets-selected", action_kind: "attack", id: "foo-alpha" })).toThrow(/action_kind must be ability or stratagem/u);
    expect(() => normalize("event", { kind: "move-ended", action_kind: "ability" })).toThrow();
  });

  it("puts the id in the trigger's filter and this model as who used it", () => {
    const text = "When this model uses its Foo ability, this model regains 1 lost wound.";
    const mechanics = compiled(placed(text, usedAbility("When this model uses its Foo ability", { subject: "this-model" }), heal("this model regains 1 lost wound", "this-model")), text);
    expect(mechanics.trigger).toEqual({ event: "used", subject: "this-model", filter: { kind: "ability", id: "foo-alpha" } });
  });

  it("takes a unit-filter before it as who used it, and that unit as the triggering unit", () => {
    const text = "Each time a unit from your army performs the Quick Step manoeuvre, that unit regains 1 lost wound.";
    const mechanics = compiled(placed(text,
      ["unit from your army", "unit-filter", { side: "friendly" }],
      ["performs the Quick Step manoeuvre", "event", { kind: "used", activity: "manoeuvre", id: "quick-step" }],
      heal("that unit regains 1 lost wound")), text);
    expect(mechanics.trigger).toEqual({ event: "used", subject: { owner: "friendly" }, filter: { kind: "manoeuvre", id: "quick-step" } });
    expect(mechanics.effect.target).toBe("event-subject");
  });

  it("does not make a bare use name a unit: \"that unit\" stays the record's own", () => {
    const text = "Each time an Order is issued, that unit regains 1 lost wound.";
    const mechanics = compiled(placed(text, ["Each time an Order is issued", "event", { kind: "used", activity: "order" }], heal("that unit regains 1 lost wound")), text);
    expect(mechanics.effect.target).toBe("this-unit");
  });

  it("refuses a used moment of an aura's recipient that does not follow its aura directly", () => {
    const text = "While a friendly ALPHA unit is within 3\" of this model, it regains 1 lost wound, and each time that unit uses its Foo ability, it regains 1 lost wound.";
    expect(errorsOf(placed(text,
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["within 3\" of this model", "aura-range", { inches: 3, of: "this-model" }],
      heal("it regains 1 lost wound"),
      usedAbility("each time that unit uses its Foo ability", { subject: "antecedent" }),
      heal("it regains 1 lost wound")), text)).toMatch(/aura's recipient must follow its aura-range directly/u);
  });
});

describe("a moment of an aura's recipient is the trigger's subject and proximity", () => {
  const text = "While a friendly ALPHA unit is within 3\" of this model, each time that unit uses its Foo ability, that unit regains 1 lost wound.";
  const leaves = (aura: Record<string, unknown> = { inches: 3, of: "this-model" }) => placed(text,
    ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["within 3\" of this model", "aura-range", aura],
    usedAbility("each time that unit uses its Foo ability", { subject: "antecedent" }),
    heal("that unit regains 1 lost wound"));

  it("drops the aura and binds the later anaphor to the triggering unit", () => {
    const mechanics = compiled(leaves(), text);
    expect(mechanics.trigger).toEqual({
      event: "used", subject: { owner: "friendly", all_of: ["ALPHA"] }, filter: { kind: "ability", id: "foo-alpha" },
      proximity: { of: "this-model", range: { inches: 3 } },
    });
    expect(mechanics.effect).toMatchObject({ type: "heal", target: "event-subject" });
    expect(JSON.stringify(mechanics.effect)).not.toContain("aura");
  });

  it("refuses an aura proximity cannot say", () => {
    expect(errorsOf(leaves({ inches: 3, of: "this-model", wholly: true }), text)).toMatch(/cannot say wholly within/u);
  });

  it("keeps the aura when the recipient is not who used the rule, or another moment follows", () => {
    const target = "While a friendly ALPHA unit is within 6\" of this model, when you target that unit with a Stratagem, that unit regains 1 lost wound.";
    const kept = compiled(placed(target,
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["you target that unit with a Stratagem", "event", { kind: "used", activity: "stratagem" }],
      heal("that unit regains 1 lost wound")), target);
    expect(kept.trigger).toEqual({ event: "used", filter: { kind: "stratagem" } });
    expect(kept.effect.type).toBe("aura");
    const either = "Each time a friendly ALPHA unit within 6\" of this model fails a Battle-shock test or is destroyed, this unit regains 1 lost wound.";
    const result = compileLeaves(placed(either,
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["fails a Battle-shock test", "event", { kind: "after-roll", roll: "battle-shock", result: "failure", subject: "antecedent" }],
      ["is destroyed", "event", { kind: "unit-destroyed" }],
      heal("this unit regains 1 lost wound", "this-unit")), either);
    expect(JSON.stringify(result)).not.toContain("proximity");
  });

  it("folds a model's Channel the Warp roll the same way", () => {
    const words = "While a friendly ALPHA model is within 6\" of this model, each time that model Channels the Warp, that unit regains 1 lost wound.";
    const mechanics = compiled(placed(words,
      ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["each time that model Channels the Warp", "event", { kind: "after-roll", roll: "channelling", subject: "antecedent" }],
      heal("that unit regains 1 lost wound")), words);
    expect(mechanics.trigger).toEqual({
      event: "after-roll", subject: { owner: "friendly", all_of: ["ALPHA"], level: "model" }, filter: { roll: "channelling" },
      proximity: { of: "this-model", range: { inches: 6 } },
    });
  });
});

describe("by-ability: the ability a moment happened through", () => {
  it("is the selecting ability of a targeting, with the filter between them as its user", () => {
    const text = "When you select a unit to be marked by a friendly ALPHA unit's Foo ability, this unit regains 1 lost wound.";
    const mechanics = compiled(placed(text,
      ["When you select a unit to be marked", "event", { kind: "targets-selected", action_kind: "ability" }],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["s Foo ability", "by-ability", { id: "foo-alpha" }],
      heal("this unit regains 1 lost wound", "this-unit")), text);
    expect(mechanics.trigger).toEqual({
      event: "targets-selected", subject: { owner: "any" }, filter: { kind: "ability" },
      source_ability: { ability_id: "foo-alpha", owner: "friendly", keywords: ["ALPHA"] },
    });
  });

  it("is a use of the ability in the same moment for a move", () => {
    const text = "Each time this unit ends a Normal move made using its Foo ability, this unit regains 1 lost wound.";
    const mechanics = compiled(placed(text,
      ["Each time this unit ends a Normal move", "event", { kind: "move-ended", move_types: ["normal"] }],
      ["using its Foo ability", "by-ability", { id: "foo-alpha" }],
      heal("this unit regains 1 lost wound", "this-unit")), text);
    expect(mechanics.trigger).toEqual({
      event: "move-ended", filter: { move_types: ["normal"] },
      condition: { type: "happened", parameters: { event: "used", filter: { kind: "ability", id: "foo-alpha" }, window: "event" } },
    });
  });

  it("refuses a by-ability with no moment, a selecting unit the DSL cannot hold, and a targeting by ability with none", () => {
    const lone = "Using its Foo ability, this unit regains 1 lost wound.";
    expect(errorsOf(placed(lone, ["Using its Foo ability", "by-ability", { id: "foo-alpha" }], heal("this unit regains 1 lost wound", "this-unit")), lone)).toMatch(/no move, selection, set-up or targeting/u);
    const text = "When you select a unit to be marked by a friendly ALPHA or BETA unit's Foo ability, this unit regains 1 lost wound.";
    expect(errorsOf(placed(text,
      ["When you select a unit to be marked", "event", { kind: "targets-selected", action_kind: "ability" }],
      ["friendly ALPHA or BETA unit", "unit-filter", { side: "friendly", any_keywords: ["ALPHA", "BETA"] }],
      ["s Foo ability", "by-ability", { id: "foo-alpha" }],
      heal("this unit regains 1 lost wound", "this-unit")), text)).toMatch(/side and every keyword/u);
    const bare = "When you select a unit to be marked, this unit regains 1 lost wound.";
    expect(errorsOf(placed(bare, ["When you select a unit to be marked", "event", { kind: "targets-selected", action_kind: "ability" }], heal("this unit regains 1 lost wound", "this-unit")), bare)).toMatch(/needs a by-ability leaf/u);
  });
});

describe("ability-used: a unit used a named rule in a window", () => {
  const leaf = (extra: Record<string, unknown>): [string, string, Record<string, unknown>] => ["in a turn in which it used its Foo ability", "ability-used", { subject: "antecedent", activity: "ability", id: "foo-alpha", window: "turn", negated: false, ...extra }];
  const text = "This unit regains 1 lost wound in a turn in which it used its Foo ability.";

  it("lowers to happened used in the window, on the record's own unit", () => {
    const mechanics = compiled(placed(text, heal("This unit regains 1 lost wound", "this-unit"), leaf({})), text);
    expect(mechanics.effect.condition).toEqual({ type: "happened", parameters: { event: "used", filter: { kind: "ability", id: "foo-alpha" }, window: "turn" } });
    const negated = compiled(placed(text, heal("This unit regains 1 lost wound", "this-unit"), leaf({ negated: true })), text);
    expect(negated.effect.condition).toEqual({ operator: "not", operands: [{ type: "happened", parameters: { event: "used", filter: { kind: "ability", id: "foo-alpha" }, window: "turn" } }] });
  });

  it("lowers now to the event window, and refuses it where no use can be in progress", () => {
    const words = "Add 1 to Charge rolls made for this unit while it is performing a Foo.";
    const mechanics = compiled(placed(words,
      ["Add 1 to Charge rolls made for this unit", "roll-modifier", { roll: "charge", operation: "add", value: 1 }],
      ["while it is performing a Foo", "ability-used", { subject: "antecedent", activity: "manoeuvre", window: "now", negated: false }]), words);
    expect(mechanics.effect.condition).toEqual({ type: "happened", parameters: { event: "used", filter: { kind: "manoeuvre" }, window: "event" } });
    expect(errorsOf(placed(text, heal("This unit regains 1 lost wound", "this-unit"), leaf({ window: "now" })), text)).toMatch(/no moment, attack or roll/u);
  });

  it("refuses an id on a rule named only as a kind", () => {
    expect(() => normalize("ability-used", { subject: "this-unit", activity: "ritual", id: "foo-alpha", window: "phase", negated: false })).toThrow(/named only as a kind/u);
  });
});

describe("named-ability core checks", () => {
  const check = (abilityId: string, parameters: Record<string, unknown>) => coreCheckErrors(dataRoot, abilityId, [{ kind: "named-ability", parameters }]);

  it("resolves a datasheet ability its datasheet holds, a core Stratagem and a faction menu action", () => {
    expect(check("catch-dat-red-bit-orks", { id: "crude-surgery-orks", activity: "ability", subject: "this-model" })).toEqual([]);
    expect(check("catch-dat-red-bit-orks", { id: "fire-overwatch", activity: "stratagem" })).toEqual([]);
    expect(check("battle-focus-aeldari", { id: "swift-as-the-wind", activity: "manoeuvre" })).toEqual([]);
  });

  it("reports an id that does not resolve, and an ability of another faction", () => {
    expect(check("catch-dat-red-bit-orks", { id: "no-such-rule-orks", activity: "ability" })[0]).toMatch(/does not resolve/u);
    expect(check("battle-focus-aeldari", { id: "crude-surgery-orks", activity: "ability" })[0]).toMatch(/no ability record of aeldari/u);
    expect(check("battle-focus-aeldari", { id: "no-such-step", activity: "manoeuvre" })[0]).toMatch(/resource-action menu/u);
  });

  it("comes back from compilation for each named id", () => {
    const text = "When this model uses its Foo ability, this model regains 1 lost wound.";
    const result = compileLeaves(placed(text, usedAbility("When this model uses its Foo ability", { subject: "this-model" }), heal("this model regains 1 lost wound", "this-model")), text);
    expect(result.ok && result.checks).toEqual([{ kind: "named-ability", parameters: { id: "foo-alpha", activity: "ability", subject: "this-model" } }]);
  });
});
