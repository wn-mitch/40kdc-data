import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { coreCheckErrors } from "../src/semantic-authoring/core-checks.js";
import { bindNamedAbilityRecipients, guardNamedAbilityPayments, localizeNamedAbilityGrantDuration, namedAbilityStateEffect, orderResourceBeforeAbilities } from "../src/semantic-authoring/compile-named-ability-states.js";
import { normalizeNamedAbilityStateParameters } from "../src/semantic-authoring/named-ability-state-families.js";

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
  });

  it("folds the aura into both moments of \"fails a Battle-shock test or is destroyed\"", () => {
    const either = "Each time a friendly ALPHA unit within 6\" of this model fails a Battle-shock test or is destroyed, this unit regains 1 lost wound.";
    const leaves = (second: Record<string, unknown>) => placed(either,
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["fails a Battle-shock test", "event", { kind: "after-roll", roll: "battle-shock", result: "failure", subject: "antecedent" }],
      ["is destroyed", "event", second],
      heal("this unit regains 1 lost wound", "this-unit"));
    const proximity = { of: "this-model", range: { inches: 6 } };
    const alpha = { owner: "friendly", all_of: ["ALPHA"] };
    expect(compiled(leaves({ kind: "unit-destroyed" }), either).trigger).toEqual([
      { event: "after-roll", filter: { roll: "battle-shock", result: "failure" }, subject: alpha, proximity },
      { event: "destroyed", object: alpha, proximity },
    ]);
    // A destruction that names its destroyer is not the recipient's own: the aura stays unfolded.
    const named = compileLeaves(leaves({ kind: "unit-destroyed", by: "enemy" }), either);
    expect(JSON.stringify(named)).not.toContain("proximity");
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

// Named ability definitions and the automatic states they grant.
// Fabricated identities and mechanic structures; no source prose.
const owner = "sample-resource-rule";
const ember = { ability_id: owner, definition_id: "ember" };
const frost = { ability_id: owner, definition_id: "frost" };
function leaf(family: string, parameters: Record<string, unknown>, at = 0): CompileLeaf {
  const version = currentFamilyVersion(family);
  return { family_id: family, family_version: version, role: familyRole(family, version), parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: at, end_byte: at + 1 };
}
const grant = { type: "ability-grant", target: "this-unit", modifier: { ability: ember } };
const exchange = { type: "rule-state", target: "this-unit", modifier: { direction: "exchanged", rule_kind: "ability", rule: ember, exchange_with: frost } };
const spend = { type: "resource-spend", target: "this-model", modifier: { pool: "sample-pool", amount: 2 } };
const phase = { type: "phase-is", parameters: { phase: "shooting" } };
const turn = { type: "player-turn-is", parameters: { turn: "your-turn" } };

describe("reviewed named ability definitions", () => {
  it("compiles a body once through the real compiler and leaves repeated grants as stable references", () => {
    const result = compileLeaves([
      leaf("named-ability-grant", { subject: "this-unit", ...ember }, 0),
      leaf("named-ability-grant", { subject: "this-model", ...ember }, 2),
      leaf("named-ability-definition", { definition_id: "ember", label: "Ember" }, 4),
      leaf("core-ability-grant", { subject: "this-unit", ability: "stealth" }, 6),
      leaf("named-ability-definition-end", {}, 8),
    ], undefined, { abilityId: owner });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toMatchObject({ type: "sequence", steps: [
      { ...grant, modifier: { ability: ember, definition: { type: "ability-part", name: "Ember", effect: { type: "ability-grant", target: "this-unit", modifier: { ability: "stealth" } } } } },
      { type: "ability-grant", target: "this-model", modifier: { ability: ember } },
    ] });
    expect(JSON.stringify(result.mechanics).match(/"definition":/g)).toHaveLength(1);
  });

  it("keeps independently printed definition sentences in their own condition scopes", () => {
    const result = compileLeaves([
      leaf("named-ability-grant", { subject: "this-unit", ...ember }, 0),
      leaf("named-ability-definition", { definition_id: "ember", label: "Ember" }, 2),
      leaf("unit-keyword", { keywords: ["VEHICLE"], subject: "this-unit", negated: false }, 4),
      leaf("core-ability-grant", { subject: "this-unit", ability: "stealth" }, 6),
      leaf("core-ability-grant", { subject: "this-unit", ability: "fights-first" }, 9),
      leaf("named-ability-definition-end", {}, 11),
    ], "g h c e. s x", { abilityId: owner });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toMatchObject({
      type: "ability-grant",
      modifier: {
        definition: {
          effect: {
            type: "sequence",
            steps: [
              {
                type: "conditional",
                effect: { type: "ability-grant", modifier: { ability: "stealth" } },
              },
              { type: "ability-grant", modifier: { ability: "fights-first" } },
            ],
          },
        },
      },
    });
  });

  it("does not interpret exchange as simultaneous grants or as selectable stance options", () => {
    const result = namedAbilityStateEffect(leaf("named-ability-exchange", { subject: "this-unit", ...ember, exchange_with: "frost" }));
    expect(result).toEqual(exchange);
    expect(namedAbilityStateEffect(leaf("named-ability-suppression", { subject: "this-unit", ...ember, except_from: "this-ability" }))).toEqual({
      type: "rule-state", target: "this-unit", modifier: { direction: "suppressed", rule_kind: "ability", rule: ember, except_from: "this-ability" },
    });
  });

  it("widens suppression to an explicitly named set without reinterpreting version 1", () => {
    const parameters = { subject: "this-unit", ...ember, except_from: "this-ability", additional_definitions: ["frost"] };
    expect(namedAbilityStateEffect(leaf("named-ability-suppression", parameters))).toEqual({ type: "sequence", steps: [ember, frost].map((rule) => ({
      type: "rule-state", target: "this-unit", modifier: { direction: "suppressed", rule_kind: "ability", rule, except_from: "this-ability" },
    })) });
    expect(() => normalizeNamedAbilityStateParameters("named-ability-suppression", parameters, 1)).toThrow("exactly");
    expect(() => normalizeNamedAbilityStateParameters("named-ability-suppression", { ...parameters, additional_definitions: ["ember"] }, 2)).toThrow("twice");
  });

  it("binds one reviewed army recipient filter across host grants without filtering resource income", () => {
    const filter = leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE FACTION"] }, 0);
    const ownership = leaf("unit-owner", { owner: "friendly" }, 2);
    const first = leaf("named-ability-grant", { subject: "antecedent", ...ember }, 10);
    const second = leaf("named-ability-grant", { subject: "antecedent", ...frost }, 20);
    const income = leaf("resource-gain", { pool: "sample-pool", amount: 1 }, 30);
    const result = bindNamedAbilityRecipients([filter, ownership, first, second, income]);
    expect(result).toEqual([
      { ...first, parameters: { ...first.parameters, subject: "filtered-units", subject_filter: { owner: "friendly", all_of: ["SAMPLE FACTION"] } } },
      { ...second, parameters: { ...second.parameters, subject: "filtered-units", subject_filter: { owner: "friendly", all_of: ["SAMPLE FACTION"] } } },
      income,
    ]);
    expect(result.at(-1)).toBe(income);
  });

  it("binds source-contained recipient filters while preserving cross-record definition identity", () => {
    const parent = "sample-parent-rule";
    const suppression = { ...leaf("named-ability-suppression", {
      subject: "antecedent", ability_id: parent, definition_id: "ember", except_from: "this-ability", additional_definitions: ["frost"],
    }, 0), end_byte: 50 };
    const suppressionFilter = leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE FACTION"] }, 1);
    const swap = { ...leaf("named-ability-exchange", {
      subject: "antecedent", ability_id: parent, definition_id: "ember", exchange_with: "frost",
    }, 60), end_byte: 100 };
    const swapFilter = leaf("unit-filter", { side: "friendly", keywords: ["SAMPLE FACTION"] }, 61);
    const result = bindNamedAbilityRecipients([suppression, suppressionFilter, swap, swapFilter]);
    expect(result).toHaveLength(2);
    expect(result.map(namedAbilityStateEffect)).toEqual([
      { type: "sequence", steps: ["ember", "frost"].map((definition_id) => ({
        type: "rule-state",
        target: { owner: "friendly", all_of: ["SAMPLE FACTION"] },
        modifier: {
          direction: "suppressed",
          rule_kind: "ability",
          rule: { ability_id: parent, definition_id },
          except_from: "this-ability",
        },
      })) },
      {
        type: "rule-state",
        target: { owner: "friendly", all_of: ["SAMPLE FACTION"] },
        modifier: {
          direction: "exchanged",
          rule_kind: "ability",
          rule: { ability_id: parent, definition_id: "ember" },
          exchange_with: { ability_id: parent, definition_id: "frost" },
        },
      },
    ]);
  });

  it("rejects duplicate definitions, missing bodies, and unstable exchange identities", () => {
    const duplicate = compileLeaves([
      leaf("named-ability-definition", { definition_id: "ember", label: "Ember" }, 0),
      leaf("named-ability-definition", { definition_id: "ember", label: "Other label" }, 2),
    ], undefined, { abilityId: owner });
    expect(duplicate).toMatchObject({ ok: false, errors: [expect.stringContaining("Duplicate named ability")] });
    const empty = compileLeaves([leaf("named-ability-definition", { definition_id: "ember", label: "Ember" })], undefined, { abilityId: owner });
    expect(empty).toMatchObject({ ok: false, errors: [expect.stringContaining("no reviewed effect")] });
    expect(() => normalizeNamedAbilityStateParameters("named-ability-exchange", { subject: "this-unit", ...ember, exchange_with: "ember" })).toThrow("distinct");
    expect(() => normalizeNamedAbilityStateParameters("named-ability-grant", { subject: "this-unit", ...ember, option_id: "ember" })).toThrow("exactly");
  });
});

describe("ordered resource-funded automatic ability states", () => {
  it("guards the complete paid exchange before spending and retains its optional local event", () => {
    const input = { type: "ability-part", trigger: { event: "phase-ended", condition: { operator: "and", operands: [phase, turn] } }, optional: true, effect: { type: "sequence", steps: [spend, exchange] } };
    expect(guardNamedAbilityPayments(input)).toEqual({ ...input, effect: {
      type: "conditional", condition: { type: "resource", parameters: { pool: "sample-pool", count: { min: 2 } } }, effect: input.effect,
    } });
    expect(() => guardNamedAbilityPayments({ type: "sequence", steps: [exchange, spend] })).toThrow("follow its payment");
  });

  it("rejects unresolved payment amounts instead of inventing a spend allowance", () => {
    expect(() => guardNamedAbilityPayments({ type: "sequence", steps: [
      { ...spend, modifier: { pool: "sample-pool", amount: "all" } }, exchange,
    ] })).toThrow("positive fixed amount");
    expect(() => guardNamedAbilityPayments({ type: "sequence", steps: [spend, spend, exchange] })).toThrow("one fixed resource payment");
  });

  it("localizes a shared grant lifetime without constraining resource income", () => {
    const income = { type: "resource-gain", target: "this-model", modifier: { pool: "sample-pool", amount: 1 } };
    const source = { type: "sequence", steps: [grant, income] };
    expect(localizeNamedAbilityGrantDuration(source, "until-next-command-phase")).toEqual({
      grants: 1,
      value: {
        type: "sequence",
        steps: [
          { type: "ability-part", duration: "until-next-command-phase", effect: grant },
          income,
        ],
      },
    });
  });

  it("runs income before mutually exclusive threshold branches while retaining each player's eligibility", () => {
    const income = { type: "ability-part", trigger: { event: "phase-ended", condition: phase }, effect: { type: "resource-gain", target: "this-model", modifier: { pool: "sample-pool", amount: 1 } } };
    const branch = (count: Record<string, number>, ability: typeof ember) => ({ type: "conditional", condition: { type: "resource", parameters: { pool: "sample-pool", count } }, effect: { ...grant, modifier: { ability } } });
    const determine = { type: "ability-part", trigger: { event: "phase-ended", condition: { operator: "and", operands: [phase, turn] } }, duration: "phase", effect: { type: "sequence", steps: [branch({ max: 3 }, ember), branch({ min: 4 }, frost)] } };
    const start = { type: "ability-part", trigger: { event: "battle-started" }, effect: grant };
    const result = orderResourceBeforeAbilities({ type: "sequence", steps: [start, determine, income] }, "sample-pool");
    expect(result).toEqual({ type: "sequence", steps: [start, {
      type: "ability-part", trigger: { event: "phase-ended" }, effect: { type: "sequence", steps: [
        { type: "conditional", condition: phase, effect: { type: "ability-part", effect: income.effect } },
        { type: "conditional", condition: determine.trigger.condition, effect: { type: "ability-part", duration: "phase", effect: determine.effect } },
      ] },
    }] });
    // Thresholds are evaluated after the income step, not copied into an early selection menu.
    expect(JSON.stringify(result)).not.toContain("stance");
    expect(() => orderResourceBeforeAbilities(start, "sample-pool")).toThrow("no separate phase-end");
  });
});

describe("a used moment aimed at a filtered unit, or at one of several rules", () => {
  const cost: [string, string, Record<string, unknown>] = ["reduce the CP cost of that use by 1CP", "stratagem-cost", { of: "stratagem", operation: "decrease", amount: 1, applies_to: "the-triggering-use" }];
  it("makes the filter and its distance the trigger's object", () => {
    const words = "When a friendly ALPHA unit within 12\" of this model is targeted with a Stratagem, reduce the CP cost of that use by 1CP.";
    const mechanics = compiled(placed(words,
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["within 12\" of this model", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "filtered-units", negated: false }],
      ["targeted with a Stratagem", "event", { kind: "used", activity: "stratagem", object: "filtered-units" }],
      cost), words);
    expect(mechanics.trigger).toEqual({
      event: "used", filter: { kind: "stratagem" },
      object: { owner: "friendly", all_of: ["ALPHA"], within: { of: "this-model", range: { inches: 12 } } },
    });
  });

  it("refuses a filtered object with no unit-filter before it", () => {
    const words = "When a unit is targeted with a Stratagem, reduce the CP cost of that use by 1CP.";
    expect(errorsOf(placed(words, ["targeted with a Stratagem", "event", { kind: "used", activity: "stratagem", object: "filtered-units" }], cost), words))
      .toMatch(/unit-filter right before it/u);
  });

  it("is one trigger per named Stratagem", () => {
    const words = "When you target this unit with the Foo/Bar Stratagem, reduce the CP cost of that use by 1CP.";
    const mechanics = compiled(placed(words,
      ["When you target this unit with the Foo/Bar Stratagem", "event", { kind: "used", activity: "stratagem", object: "this-unit", ids: ["foo", "bar"] }],
      cost), words);
    expect(mechanics.trigger).toEqual([
      { event: "used", filter: { kind: "stratagem", id: "foo" }, object: "this-unit" },
      { event: "used", filter: { kind: "stratagem", id: "bar" }, object: "this-unit" },
    ]);
    expect(() => normalize("event", { kind: "used", activity: "stratagem", ids: ["foo"] })).toThrow(/two or more/u);
    expect(() => normalize("event", { kind: "used", activity: "stratagem", id: "foo", ids: ["foo", "bar"] })).toThrow(/instead of id/u);
  });
});
