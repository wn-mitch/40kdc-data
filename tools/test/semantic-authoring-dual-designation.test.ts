import { describe, expect, it } from "vitest";

import type { BuffSource, EngineContext } from "../src/cruncher/buffs.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { designation } from "../src/semantic-authoring/compile-wrappers.js";
import { classifyUnsupported } from "../src/semantic-authoring/gates.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility, describeEffectInline } from "../src/translate/effect.js";

// Fabricated wording and keywords only; no GW rule prose.

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order. */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
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

const run = (text: string, items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-dual-designation", name: "Combined Fire" });

const SELECT: Item = ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }];
const DURATION: Item = ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }];
const COVER: Item = ["that enemy unit cannot have the Benefit of Cover", "rule-state", { subject: "antecedent", direction: "suppressed", rule_kind: "core-rule", rule: "benefit-of-cover" }];
const ALPHA: Item = ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }];
const OWNER: Item = ["from your army", "unit-owner", { owner: "friendly" }];
const ATTACK: Item = ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }];
const TARGETS: Item = ["that targets that unit", "target-is-selected", {}];
const STRENGTH: Item = ["improve the Strength characteristic of that attack by 2", "characteristic-modifier", { subject: "attack", characteristics: ["S"], operation: "improve", value: 2, weapon_type: "all" }];

const TEXT = "Select one enemy unit. Until the end of the phase, that enemy unit cannot have the Benefit of Cover, and each time an ALPHA unit from your army makes an attack that targets that unit, improve the Strength characteristic of that attack by 2.";
const LEAVES: Item[] = [SELECT, DURATION, COVER, ALPHA, OWNER, ATTACK, TARGETS, STRENGTH];

const COVER_ENTRY = { to: "target", effect: { type: "rule-state", target: "selected-unit", modifier: { direction: "suppressed", rule_kind: "core-rule", rule: "benefit-of-cover" } } };
const STRENGTH_ENTRY = { to: "attackers-of-target", effect: { type: "stat-modifier", target: { owner: "friendly", all_of: ["ALPHA"] }, modifier: { stat: "S", operation: "improve", value: 2 } } };
const DESIGNATION = {
  type: "designate-target",
  designation: "combined-fire-target",
  select: { kind: "unit", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 } } },
  applies: [COVER_ENTRY, STRENGTH_ENTRY],
  duration: "phase",
};

describe("A designation that acts on the unit and on attacks against it", () => {
  it("gives the unit's own effect and the attacks' effect one entry each, in printed order", () => {
    const result = run(TEXT, LEAVES);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual(DESIGNATION);
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
    expect(validate(result.mechanics.effect), JSON.stringify(validate.errors)).toBe(true);
  });

  it("puts the attacks' entry first when the record prints it first", () => {
    const leaves = placed(TEXT, ...LEAVES);
    const select = leaves[0]!;
    const body = STRENGTH_ENTRY.effect;
    const after = designation("Combined Fire", select, leaves, body, "phase", null, null, false, { effect: COVER_ENTRY.effect, start: Buffer.byteLength(TEXT) });
    expect((after.applies as Array<{ to: string }>).map((entry) => entry.to)).toEqual(["attackers-of-target", "target"]);
    const before = designation("Combined Fire", select, leaves, body, "phase", null, null, false, { effect: COVER_ENTRY.effect, start: 0 });
    expect((before.applies as Array<{ to: string }>).map((entry) => entry.to)).toEqual(["target", "attackers-of-target"]);
  });

  it("reads a clause after the attacks' effect that names the selected unit as that unit's own entry", () => {
    const text = "Select one enemy unit. Until the end of the phase, each time an ALPHA unit from your army makes an attack that targets that unit, improve the Strength characteristic of that attack by 2, and that enemy unit cannot have the Benefit of Cover.";
    const result = run(text, [SELECT, DURATION, ALPHA, OWNER, ATTACK, TARGETS, STRENGTH, COVER]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    // Not one attackers-of-target entry holding both: losing Cover is not limited to those attacks.
    expect(result.mechanics.effect).toEqual({ ...DESIGNATION, applies: [STRENGTH_ENTRY, COVER_ENTRY] });
  });

  it("keeps an effect on the selected unit in the attack's own clause limited to those attacks", () => {
    const text = "Select one enemy unit. Until the end of the phase, each time an ALPHA unit from your army makes an attack that targets that unit, that enemy unit cannot have the Benefit of Cover.";
    const result = run(text, [SELECT, DURATION, ALPHA, OWNER, ATTACK, TARGETS, COVER]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toMatchObject({ applies: { to: "attackers-of-target", effect: COVER_ENTRY.effect } });
  });

  it("still refuses an effect on a unit other than the selected one", () => {
    const text = "Select one enemy unit. Until the end of the phase, this unit cannot have the Benefit of Cover, and each time an ALPHA unit from your army makes an attack that targets that unit, improve the Strength characteristic of that attack by 2.";
    const result = run(text, [SELECT, DURATION, ["this unit cannot have the Benefit of Cover", "rule-state", { subject: "this-unit", direction: "suppressed", rule_kind: "core-rule", rule: "benefit-of-cover" }], ALPHA, OWNER, ATTACK, TARGETS, STRENGTH]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/not every effect is limited to attacks against it/u);
  });

  it("reads each entry with its own moment, inline and as a block", () => {
    expect(describeEffectInline(DESIGNATION as never)).toBe(
      "select one enemy unit (your Combined Fire Target); until the end of the phase, while it is your target, the selected unit cannot benefit from Cover; and each time a friendly unit attacks it, improve all friendly ALPHA units' Strength characteristic by 2",
    );
    expect(describeAbility({ effect: DESIGNATION as never, scope: { duration: "phase" } })).toContain(
      "Select one enemy unit (your Combined Fire Target). Until the end of the phase:\n  -> While it is your target, the selected unit cannot benefit from Cover.\n  -> Each time a friendly unit makes an attack against it, improve all friendly ALPHA units' Strength characteristic by 2.",
    );
  });

  it("makes the attacks' entry a lever and leaves the unit's own entry unsupported", () => {
    const source: BuffSource = { kind: "ability", abilityId: "fabricated-dual-designation", abilityKind: "unit" };
    const ctx: EngineContext = { phase: "shooting", attackerStationary: false, attackerKeywords: ["ALPHA"] };
    const translation = effectToBuffs(DESIGNATION as never, source, ctx);
    expect(translation.activatable.map((lever) => lever.id)).toEqual(["fabricated-dual-designation#combined-fire-target"]);
    expect(translation.unsupported.map((item) => item.reason)).toEqual(["designate-target debuff on the marked unit: not a buff on the bearer"]);
    // The gate reads the unit's own entry as the designated unit sees it: losing Cover is outside the damage path.
    expect(classifyUnsupported(translation.unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
  });

  it("counts a debuff entry with no known recipient as an unrecognized shape", () => {
    const unsupported = [{ reason: "designate-target debuff on the marked unit: not a buff on the bearer", effectFragment: { type: "designate-target", applies: { effect: COVER_ENTRY.effect } } }];
    expect(classifyUnsupported(unsupported as never)).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 });
  });
});
