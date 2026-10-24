import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { leafFragment } from "../src/semantic-authoring/compile-leaf-fragment.js";
import { coreCheckErrors } from "../src/semantic-authoring/core-checks.js";
import { semanticAuthoringDataRoot } from "../src/semantic-authoring/entries.js";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/index.js";

/** Normalized leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT",
    };
  });
}

function compiled(list: CompileLeaf[], text?: string) {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

function errorsOf(list: CompileLeaf[], text?: string): string[] {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics)}`);
  return result.errors;
}

type Item = [string, string, Record<string, unknown>];
const WARDENS: Item = ["Friendly GLOOM WARDENS units", "unit-filter", { side: "friendly", keywords: ["GLOOM WARDENS"] }];
const header = (wording: string, printed: string, subject = "antecedent"): Item => [wording, "ability-record-grant", { subject, printed }];
const label = (wording: string, name: string): Item => [wording, "granted-ability-name", { label: name }];

const AURA_TEXT = 'Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward (Aura):** While a friendly GLOOM HOUND unit is within 6" of this unit, that unit\'s melee attacks have +1 WS.';
const auraBody: Item[] = [
  ["friendly GLOOM HOUND unit", "unit-filter", { side: "friendly", keywords: ["GLOOM HOUND"] }],
  ['within 6" of this unit', "aura-range", { inches: 6, of: "this-unit" }],
  ["that unit's melee attacks", "attack", { direction: "makes", unit: "that-unit", attack_type: "melee" }],
  ["+1 WS", "characteristic-modifier", { characteristics: ["WS"], operation: "improve", value: 1 }],
];

const RALLY_TEXT = "Bannerman model only. This model has +1 OC. The following ability:Rallying Cry (Once per battle, per army): When this unit is selected to fight, you can use this ability. If you do, this unit's melee attacks have +1 A until the end of the phase.";
const rallyLeaves = (): CompileLeaf[] => placed(RALLY_TEXT,
  ["Bannerman model only", "bearer-eligibility", { keywords: ["BANNERMAN"], match: "all", excluded_keywords: [] }],
  ["This model has +1 OC", "characteristic-modifier", { subject: "this-model", characteristics: ["OC"], operation: "add", value: 1, weapon_type: "all" }],
  header("The following ability", "one", "this-model"),
  label("Rallying Cry", "Rallying Cry"),
  ["Once per battle, per army", "usage-limit", { frequency: "once-per-battle", per: "army" }],
  ["When this unit is selected to fight", "event", { kind: "selected", to: "fight" }],
  ["you can use this ability", "optional-use", { who: "you" }],
  ["this unit's melee attacks have +1 A", "characteristic-modifier", { subject: "this-unit", characteristics: ["A"], operation: "add", value: 1, weapon_type: "melee" }],
  ["until the end of the phase", "duration", { endpoint: "end-of-phase" }]);

describe("Semantic authoring printed granted abilities", () => {
  it("gives a filter's units a named aura as their own ability (S2)", () => {
    const result = compiled(placed(AURA_TEXT, WARDENS, header("have the following ability", "one"), label("Shade Ward (Aura", "Shade Ward"), ...auraBody), AURA_TEXT);
    const { effect, behavior, trigger, usage, scope } = result.mechanics as Record<string, any>;
    expect(effect.type).toBe("ability-grant");
    expect(effect.target).toEqual({ owner: "friendly", all_of: ["GLOOM WARDENS"] });
    expect(effect.modifier.ability).toBe("shade-ward");
    expect(effect.modifier.definition).toMatchObject({ type: "ability-part", name: "Shade Ward", effect: { type: "aura" } });
    // The aura is the holder's; the host record is a passive grant.
    expect(JSON.stringify(effect.modifier.definition.effect)).toContain("GLOOM HOUND");
    expect(behavior).toBe("passive");
    expect(trigger).toBeNull();
    expect(usage).toBeUndefined();
    expect(scope).toEqual({ duration: "permanent" });
  });

  it("keeps a self-held body's usage, moment and duration on its part, not on the record (S1)", () => {
    const result = compiled(rallyLeaves(), RALLY_TEXT);
    const { effect, behavior, usage, scope, trigger } = result.mechanics as Record<string, any>;
    expect(effect.type).toBe("sequence");
    expect(effect.steps[0].type).toBe("stat-modifier");
    const part = effect.steps[1];
    expect(part).toMatchObject({ type: "ability-part", name: "Rallying Cry", usage: { per: "army" }, duration: "phase" });
    expect(part.trigger).toBeTruthy();
    expect(part.effect.type).toBe("stat-modifier");
    // Nothing of the body leaks onto the host: no record usage, trigger or duration.
    expect(usage).toBeUndefined();
    expect(trigger).toBeNull();
    expect(scope).toEqual({ duration: "permanent" });
    expect(behavior).toBe("reactive");
    expect(result.checks.map((check) => check.kind)).toEqual(["bearer-eligibility"]);
  });

  it("compiles a self-held grant that is the record's only effect as the record itself", () => {
    const text = 'KNIGHT GLOOM model only. The bearer has the following ability:\n**Dread Sigil (Aura):** While a friendly GLOOM HOUND unit is within 6" of this model, that unit\'s melee attacks have +1 WS.';
    const result = compiled(placed(text,
      ["KNIGHT GLOOM model only", "bearer-eligibility", { keywords: ["KNIGHT GLOOM"], match: "all", excluded_keywords: [] }],
      header("has the following ability", "one", "this-model"),
      label("Dread Sigil (Aura", "Dread Sigil"),
      ["friendly GLOOM HOUND unit", "unit-filter", { side: "friendly", keywords: ["GLOOM HOUND"] }],
      ['within 6" of this model', "aura-range", { inches: 6, of: "this-model" }],
      ["that unit's melee attacks", "attack", { direction: "makes", unit: "that-unit", attack_type: "melee" }],
      ["+1 WS", "characteristic-modifier", { characteristics: ["WS"], operation: "improve", value: 1 }]), text);
    expect((result.mechanics.effect as Record<string, unknown>).type).toBe("aura");
    expect(result.mechanics.behavior).toBe("aura");
    expect(result.checks.map((check) => check.kind)).toEqual(["bearer-eligibility"]);
  });

  it("gives each of several printed abilities its own grant, with a bare cadence per holder (S3)", () => {
    const text = "Friendly GLOOM WARDENS units have the following abilities:\n**Dark Step:** Once per turn, when this unit is selected to shoot, this unit's ranged attacks have +1 S.\n**Pale Shroud:** This unit has a 5+ invulnerable save.";
    const result = compiled(placed(text, WARDENS, header("have the following abilities", "several"),
      label("Dark Step", "Dark Step"),
      ["Once per turn", "usage-limit", { frequency: "once-per-turn", per: "unit" }],
      ["when this unit is selected to shoot", "event", { kind: "selected", to: "shoot" }],
      ["this unit's ranged attacks have +1 S", "characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_type: "ranged" }],
      label("Pale Shroud", "Pale Shroud"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text);
    const { effect, usage } = result.mechanics as Record<string, any>;
    expect(effect.type).toBe("sequence");
    expect(effect.steps.map((step: any) => [step.type, step.modifier.ability, step.modifier.definition.name])).toEqual([
      ["ability-grant", "dark-step", "Dark Step"], ["ability-grant", "pale-shroud", "Pale Shroud"],
    ]);
    expect(effect.steps[0].modifier.definition.usage).toMatchObject({ per: "unit" });
    expect(effect.steps[0].modifier.definition.trigger).toBeTruthy();
    expect(effect.steps[1].modifier.definition).not.toHaveProperty("usage");
    expect(usage).toBeUndefined();
  });

  it("grants an unnamed body with no ability id (S4)", () => {
    const text = "friendly GLOOM WARDENS units have the following:\nEach time a model in this unit makes an attack, re-roll a Hit roll of 1.";
    const result = compiled(placed(text,
      ["friendly GLOOM WARDENS units", "unit-filter", { side: "friendly", keywords: ["GLOOM WARDENS"] }],
      header("have the following", "unnamed"),
      ["makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }]), text);
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("ability-grant");
    expect(effect.modifier).not.toHaveProperty("ability");
    expect(effect.modifier.definition.type).toBe("ability-part");
    expect(effect.modifier.definition).not.toHaveProperty("name");
  });

  it("gives a model-level grant to the models' unit once, as one definition", () => {
    const text = "Friendly GLOOM HOUND models have the following ability:\n**Shade Ward:** This unit has a 5+ invulnerable save.";
    const result = compiled(placed(text,
      ["Friendly GLOOM HOUND models", "unit-filter", { side: "friendly", keywords: ["GLOOM HOUND"], level: "model" }],
      header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text);
    // One grant on the model filter: the schema reads it as one copy for each unit with such a model.
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("ability-grant");
    expect(effect.target).toEqual({ owner: "friendly", all_of: ["GLOOM HOUND"], level: "model" });
    expect(effect.modifier.definition.effect.target).toBe("this-unit");
  });

  it("keeps a printed aura on each model holder while its body grants only the aura recipient", () => {
    const text = 'Friendly GLIMMER SAGE models have the following ability:\n**Guiding Echoes (Aura):** While a friendly GLOOM HOUND unit is within 12" of this model, that unit has the Battle Focus ability.';
    const result = compiled(placed(text,
      ["Friendly GLIMMER SAGE models", "unit-filter", { side: "friendly", keywords: ["GLIMMER", "SAGE"], level: "model" }],
      header("have the following ability", "one"), label("Guiding Echoes (Aura", "Guiding Echoes"),
      ['While a friendly GLOOM HOUND unit is within 12" of this model', "aura-range", { inches: 12, side: "friendly", keywords: ["GLOOM HOUND"], of: "this-model" }],
      ["that unit has the Battle Focus ability", "ability-record-grant", { subject: "antecedent", ability: "battle-focus-aeldari" }]), text);
    const effect = result.mechanics.effect as Record<string, any>;

    expect(effect).toMatchObject({
      type: "ability-grant",
      target: { owner: "friendly", all_of: ["GLIMMER", "SAGE"], level: "model" },
      modifier: {
        ability: "guiding-echoes",
        definition: {
          type: "ability-part",
          name: "Guiding Echoes",
          effect: {
            type: "aura",
            target: "friendly-within-aura",
            modifier: {
              range: { inches: 12 },
              eligible: { owner: "friendly", all_of: ["GLOOM HOUND"] },
              effect: {
                type: "ability-grant",
                target: "recipient",
                modifier: { ability: "battle-focus-aeldari" },
              },
            },
          },
        },
      },
    });
    expect(effect.modifier.definition.effect.modifier.effect.target).not.toBe("this-unit");
  });

  it("ends a body at its paragraph and gives the leaves after it back to the host", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** This unit has a 5+ invulnerable save.\nThis model has Feel No Pain 5+.";
    const result = compiled(placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
      ["Feel No Pain 5+", "feel-no-pain", { subject: "this-model", threshold: 5, against: "all" }]), text);
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("sequence");
    expect(effect.steps.map((step: any) => step.type)).toEqual(["ability-grant", "feel-no-pain"]);
    expect(effect.steps[1].target).toBe("this-model");
    expect(effect.steps[0].modifier.definition.effect.type).toBe("invulnerable-save");
  });

  it("continues a body onto an Or: line that follows it", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** This unit has a 5+ invulnerable save.\nOr: This unit has Feel No Pain 5+.";
    const result = compiled(placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
      ["Or: This unit has Feel No Pain 5+", "feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }]), text);
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("ability-grant");
    expect(effect.modifier.definition.effect.steps.map((step: any) => step.type)).toEqual(["invulnerable-save", "feel-no-pain"]);
  });

  it("continues a body with a colon-led line and a period before an Or: line", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** While this unit is selected, roll one D6:\nOn a 2+, this unit has a 5+ invulnerable save. This ability is used once per turn.\nOr: This unit has Feel No Pain 5+.";
    const result = compiled(placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["On a 2+, this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
      ["Or: This unit has Feel No Pain 5+", "feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }]), text);
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("ability-grant");
    expect(effect.modifier.definition.effect.steps.map((step: any) => step.type)).toEqual(["invulnerable-save", "feel-no-pain"]);
  });

  it("does not extend a host paragraph over an Or: line", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** This unit has a 5+ invulnerable save.\nThis model has Feel No Pain 5+.\nOr: This unit has a 4+ invulnerable save.";
    const result = compiled(placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
      ["This model has Feel No Pain 5+", "feel-no-pain", { subject: "this-model", threshold: 5, against: "all" }],
      ["Or: This unit has a 4+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 4 }]), text);
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("sequence");
    expect(effect.steps[0].type).toBe("ability-grant");
    expect(effect.steps[0].modifier.definition.effect.type).toBe("invulnerable-save");
    expect(effect.steps.slice(1).map((step: any) => step.type)).toEqual(["feel-no-pain", "invulnerable-save"]);
  });

  it("carries a body's own Stratagem event as a check the record makes", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Dusk Veil:** When you use the Shade Step stratagem, this unit has a 5+ invulnerable save.";
    const result = compiled(placed(text, WARDENS, header("have the following ability", "one"), label("Dusk Veil", "Dusk Veil"),
      ["When you use the Shade Step stratagem", "event", { kind: "used", activity: "stratagem", id: "shade-step-stratagem" }],
      ["this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text);
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("ability-grant");
    expect(effect.modifier.definition.trigger.filter).toEqual({ kind: "stratagem", id: "shade-step-stratagem" });
    expect(result.checks).toEqual([{ kind: "named-ability", parameters: { id: "shade-step-stratagem", activity: "stratagem" } }]);
  });

  it("resolves a body's Stratagem check against the core Stratagem it names", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Dusk Veil:** When you use the Into Darkness stratagem, this unit has a 5+ invulnerable save.";
    const list = (id: string) => placed(text, WARDENS, header("have the following ability", "one"), label("Dusk Veil", "Dusk Veil"),
      ["When you use the Into Darkness stratagem", "event", { kind: "used", activity: "stratagem", id }],
      ["this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]);
    const good = compiled(list("into-darkness-shadowmark-talon-raven-guard"), text);
    expect(coreCheckErrors(semanticAuthoringDataRoot(), "fabricated-ability", good.checks)).toEqual([]);
    const typo = compiled(list("into-darkness"), text);
    const errors = coreCheckErrors(semanticAuthoringDataRoot(), "fabricated-ability", typo.checks);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/into-darkness/u);
  });

  it("continues a body onto the next line after a colon", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** This unit has a 5+ invulnerable save and:\nThis unit has Feel No Pain 5+.";
    const result = compiled(placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
      ["Feel No Pain 5+", "feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }]), text);
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("ability-grant");
    expect(effect.modifier.definition.effect.type).toBe("sequence");
  });
});

describe("Semantic authoring printed granted abilities: refusals", () => {
  const shadeWard = (printed: string, ...markers: Item[]) => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** **Dusk Veil:** This unit has a 5+ invulnerable save.";
    return { text, list: placed(text, WARDENS, header("have the following ability", printed), ...markers,
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]) };
  };

  it("refuses a marker count that disagrees with the header", () => {
    const one = shadeWard("one", label("Shade Ward", "Shade Ward"), label("Dusk Veil", "Dusk Veil"));
    expect(errorsOf(one.list, one.text)[0]).toMatch(/needs exactly one granted-ability-name.*found 2/u);
    const several = shadeWard("several", label("Shade Ward", "Shade Ward"));
    expect(errorsOf(several.list, several.text)[0]).toMatch(/two or more.*found 1/u);
    const unnamed = shadeWard("unnamed", label("Shade Ward", "Shade Ward"));
    expect(errorsOf(unnamed.list, unnamed.text)[0]).toMatch(/needs no granted-ability-name.*found 1/u);
  });

  it("refuses a granted-ability-name with no printed header before it", () => {
    const text = "**Shade Ward:** This unit has a 5+ invulnerable save.";
    expect(errorsOf(placed(text, label("Shade Ward", "Shade Ward"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text)[0]).toMatch(/no printed ability-record-grant header/u);
  });

  it("refuses a leaf between the header and its first marker", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability in your turn:\n**Shade Ward:** This unit has a 5+ invulnerable save.";
    expect(errorsOf(placed(text, WARDENS, header("have the following ability", "one"),
      ["in your turn", "phase-window", { phase: "any", turn: "your" }],
      label("Shade Ward", "Shade Ward"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text)[0]).toMatch(/sits between a printed grant header/u);
  });

  it("refuses a body with no effect", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** Once per turn.\nThis model has Feel No Pain 5+.";
    expect(errorsOf(placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["Once per turn", "usage-limit", { frequency: "once-per-turn", per: "unit" }],
      ["Feel No Pain 5+", "feel-no-pain", { subject: "this-model", threshold: 5, against: "all" }]), text)[0]).toMatch(/Shade Ward has no effect leaf/u);
  });

  it("refuses a grant printed inside a granted body", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** This unit has a 5+ invulnerable save, and friendly GLOOM HOUND units have the following ability: **Dusk Veil:** This unit has Feel No Pain 5+.";
    expect(errorsOf(placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
      ["friendly GLOOM HOUND units", "unit-filter", { side: "friendly", keywords: ["GLOOM HOUND"] }],
      header("have the following ability", "one"), label("Dusk Veil", "Dusk Veil"),
      ["Feel No Pain 5+", "feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }]), text)[0]).toMatch(/nested grants/u);
  });

  it("refuses a body Stratagem check its trigger does not name", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Dusk Veil:** When you use the Shade Step stratagem, this unit has a 5+ invulnerable save.";
    expect(errorsOf(placed(text, WARDENS, header("have the following ability", "one"), label("Dusk Veil", "Dusk Veil"),
      ["When you use the Shade Step stratagem", "event", { kind: "used", activity: "stratagem", id: "shade-step-stratagem", subject: "this-unit" }],
      ["this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text)[0]).toMatch(/Dusk Veil: a granted ability cannot hold/u);
  });

  it("refuses a body Stratagem check that names another Stratagem than its trigger", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Dusk Veil:** When you use the Shade Step stratagem, and only if this unit used the Veil Dance stratagem this turn, this unit has a 5+ invulnerable save.";
    expect(errorsOf(placed(text, WARDENS, header("have the following ability", "one"), label("Dusk Veil", "Dusk Veil"),
      ["When you use the Shade Step stratagem", "event", { kind: "used", activity: "stratagem", id: "shade-step-stratagem" }],
      ["this unit used the Veil Dance stratagem this turn", "ability-used", { subject: "this-unit", activity: "stratagem", id: "veil-dance-stratagem", window: "turn", negated: false }],
      ["this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text)[0]).toMatch(/Dusk Veil: a granted ability cannot hold/u);
  });

  it("refuses a body that targets a Stratagem target", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Dusk Veil:** One unit from your army is chosen as the target, and this unit has a 5+ invulnerable save.";
    expect(errorsOf(placed(text, WARDENS, header("have the following ability", "one"), label("Dusk Veil", "Dusk Veil"),
      ["One unit from your army is chosen as the target", "stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["INFANTRY"], match: "all", excluded_keywords: [] }],
      ["this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text)[0]).toMatch(/Dusk Veil: a granted ability cannot hold/u);
  });

  it("refuses a body holding a bearer restriction", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** Sergeant model only. This unit has a 5+ invulnerable save.";
    expect(errorsOf(placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["Sergeant model only", "bearer-eligibility", { keywords: ["SERGEANT"], match: "all", excluded_keywords: [] }],
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text)[0]).toMatch(/Shade Ward: a granted ability cannot hold/u);
  });

  it("refuses a printed header without source text", () => {
    expect(errorsOf(placed(AURA_TEXT, WARDENS, header("have the following ability", "one"), label("Shade Ward (Aura", "Shade Ward"), ...auraBody))[0]).toMatch(/needs the source text/u);
  });

  it("passes a body's compile error up under its label", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** Once per turn, this unit has a 5+ invulnerable save.";
    expect(errorsOf(placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["Once per turn", "usage-limit", { frequency: "once-per-turn" }],
      ["this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]), text)[0]).toMatch(/^Shade Ward: Usage frequency needs a reviewed usage scope/u);
  });

  it("keeps a v2 named record grant unchanged", () => {
    const text = "Friendly GLOOM WARDENS units have the Shade Ward ability.";
    const result = compiled(placed(text, WARDENS, ["have the Shade Ward ability", "ability-record-grant", { subject: "antecedent", ability: "shade-ward" }]), text);
    expect(result.mechanics.effect).toEqual({ type: "ability-grant", target: { owner: "friendly", all_of: ["GLOOM WARDENS"] }, modifier: { ability: "shade-ward" } });
  });
});

describe("Semantic authoring printed grant families", () => {
  const version = () => currentFamilyVersion("ability-record-grant");

  it("names an ability or printed, never both, and printed takes no rating", () => {
    expect(normalizeFingerprintParameters("ability-record-grant", { subject: "antecedent", printed: "several" }, version())).toEqual({ subject: "antecedent", printed: "several" });
    expect(() => normalizeFingerprintParameters("ability-record-grant", { subject: "this-unit", printed: "one", ability: "shade-ward" }, version())).toThrow(/not both/u);
    expect(() => normalizeFingerprintParameters("ability-record-grant", { subject: "this-unit", printed: "one", value: 2 }, version())).toThrow(/value and rules_bundle/u);
    expect(() => normalizeFingerprintParameters("ability-record-grant", { subject: "this-unit", printed: "two" }, version())).toThrow(/printed must be one of/u);
    expect(() => normalizeFingerprintParameters("ability-record-grant", { subject: "this-unit" }, version())).toThrow(/names an ability, or printed/u);
  });

  it("keeps a label to the ability's name", () => {
    expect(normalizeFingerprintParameters("granted-ability-name", { label: " **Shade  Ward** " }, 1)).toEqual({ label: "Shade Ward" });
    expect(() => normalizeFingerprintParameters("granted-ability-name", { label: "Shade Ward (Aura)" }, 1)).toThrow(/name only/u);
    expect(() => normalizeFingerprintParameters("granted-ability-name", { label: "Shade Ward", aura: true }, 1)).toThrow(/exactly: label/u);
  });

  it("previews both families as implicit leaves", () => {
    const [grant, name] = placed(AURA_TEXT, header("have the following ability", "one", "this-unit"), label("Shade Ward (Aura", "Shade Ward"));
    expect(leafFragment(grant!).kind).toBe("implicit");
    expect(leafFragment(name!).kind).toBe("implicit");
  });
});

describe("ability-grant definition in the DSL", () => {
  const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
  const part = { type: "ability-part", name: "Shade Ward", effect: { type: "invulnerable-save", target: "this-unit", modifier: { invuln_sv: 5 } } };
  const grant = (modifier: Record<string, unknown>) => ({ type: "ability-grant", target: { owner: "friendly", all_of: ["GLOOM WARDENS"] }, modifier });

  it("accepts a definition with or without its id, and still a plain named grant", () => {
    expect(validate(grant({ ability: "shade-ward", definition: part }))).toBe(true);
    expect(validate(grant({ definition: part }))).toBe(true);
    expect(validate(grant({ ability: "shade-ward", value: 2 }))).toBe(true);
  });

  it("rejects a grant naming neither, and a definition with a rating or as a rules bundle", () => {
    expect(validate(grant({}))).toBe(false);
    expect(validate(grant({ ability: "shade-ward", definition: part, value: 2 }))).toBe(false);
    expect(validate(grant({ ability: "shade-ward", definition: part, rules_bundle: true }))).toBe(false);
    expect(validate(grant({ ability: "shade-ward", definition: { name: "Shade Ward" } }))).toBe(false);
  });

  it("renders what the compiler emits, without asking the holder to use a passive ability", () => {
    const result = compiled(placed(AURA_TEXT, WARDENS, header("have the following ability", "one"), label("Shade Ward (Aura", "Shade Ward"), ...auraBody), AURA_TEXT);
    expect(validate(result.mechanics.effect)).toBe(true);
    const text = describeAbility({ effect: result.mechanics.effect as never, scope: { duration: "permanent" } });
    expect(text.split("\n")[0]).toBe("All friendly GLOOM WARDENS units gain the Shade Ward ability:");
    expect(text).toContain("GLOOM HOUND");
    expect(text).not.toMatch(/use Shade Ward/iu);
    const rally = compiled(rallyLeaves(), RALLY_TEXT);
    expect(validate(rally.mechanics.effect)).toBe(true);
  });
});

describe("Semantic authoring printed grants: a record's grant to other units and refusals that name it", () => {
  const SELF_TEXT = "Friendly GLOOM WARDENS units with this ability have the following ability:\n**Shade Ward:** This unit has a 5+ invulnerable save.\nFriendly MONSTER units benefit from the Shade Ward rule.";
  const selfLeaves = (): CompileLeaf[] => placed(SELF_TEXT, WARDENS, ["with this ability", "unit-has-ability", { subject: "antecedent", own: true }], header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
    ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
    ["Friendly MONSTER units", "unit-filter", { side: "friendly", keywords: ["MONSTER"] }],
    ["benefit from the Shade Ward rule", "ability-record-grant", { subject: "antecedent", ability: "shade-ward" }]);

  it("gives the units a record grants to its own bodies, not the bare record id", () => {
    const result = compileLeaves(selfLeaves(), SELF_TEXT, { abilityId: "shade-ward" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = JSON.stringify(result.mechanics.effect);
    expect(effect).toContain('"target":{"owner":"friendly","all_of":["MONSTER"]}');
    expect(effect).toContain('"definition":{"type":"ability-part","name":"Shade Ward"');
    expect(effect).not.toContain('"modifier":{"ability":"shade-ward"}');
  });

  // The "with this ability" header needs the record's id; a grant naming a different id than the record's stays a plain record grant.
  it("keeps a grant of another record as a plain record grant", () => {
    const result = compileLeaves(selfLeaves(), SELF_TEXT, { abilityId: "other-record" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.mechanics.effect)).toContain('"modifier":{"ability":"shade-ward"}');
  });

  it("names the record in a body refusal when the record id is known", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** Sergeant model only. This unit has a 5+ invulnerable save.";
    const list = placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["Sergeant model only", "bearer-eligibility", { keywords: ["SERGEANT"], match: "all", excluded_keywords: [] }],
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]);
    const named = compileLeaves(list, text, { abilityId: "shade-ward" });
    expect(named.ok).toBe(false);
    expect(named.ok ? "" : named.errors[0]).toMatch(/^Shade Ward in shade-ward: a granted ability cannot hold/u);
    expect(errorsOf(list, text)[0]).toMatch(/^Shade Ward: a granted ability cannot hold/u);
  });
});

describe("Semantic authoring army condition with a following filter before a granted body", () => {
  // The army condition's filter and the printed grant's filter are two units, not one stacked filter.
  const TEXT = "If your army includes a Vulkan unit, friendly Infernus units have the following:this unit has a 5+ invulnerable save.";
  const leaves = (): CompileLeaf[] => placed(TEXT,
    ["If your army includes", "army-includes", { quantifier: "some", with: "following-filter" }],
    ["a Vulkan unit", "unit-filter", { side: "friendly", keywords: ["VULKAN"] }],
    ["friendly Infernus units", "unit-filter", { side: "friendly", keywords: ["INFERNUS"] }],
    ["have the following:", "ability-record-grant", { subject: "antecedent", printed: "unnamed" }],
    ["this unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]);

  it("keeps the condition's filter and the granted units' filter apart", () => {
    const result = compiled(leaves(), TEXT);
    const effect = JSON.stringify(result.mechanics.effect);
    expect(effect).toContain('"condition":{"type":"army-includes","parameters":{"filter":{"owner":"friendly","all_of":["VULKAN"]}}}');
    expect(effect).toContain('"target":{"owner":"friendly","all_of":["INFERNUS"]}');
    expect(effect).not.toContain("INFERNUS\",\"VULKAN");
  });
});

describe("Semantic authoring printed grants: a units-only section narrows its body's holders", () => {
  const TEXT = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** GLOOM HOUND units only: This unit has a 5+ invulnerable save.";
  const body = (filter: Item): CompileLeaf[] => placed(TEXT, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
    filter, ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }]);

  it("grants the body to the header's units that also have the section's keywords", () => {
    const result = compiled(body(["GLOOM HOUND units only", "unit-filter", { side: "friendly", keywords: ["GLOOM HOUND"] }]), TEXT);
    expect(JSON.stringify(result.mechanics.effect)).toContain('"target":{"owner":"friendly","all_of":["GLOOM WARDENS","GLOOM HOUND"]}');
  });

  it("refuses a units-only section that names more than keywords", () => {
    const errors = errorsOf(body(["GLOOM HOUND units only", "unit-filter", { side: "friendly", keywords: ["GLOOM HOUND"], any_keywords: ["MONSTER", "VEHICLE"] }]), TEXT);
    expect(errors[0]).toMatch(/narrows by keywords alone/u);
  });
});

describe("Semantic authoring printed grants: a self-grant gives only the own-ability bodies", () => {
  it("keeps a grant to other units plain when the header is not the record's own ability", () => {
    const text = "Friendly GLOOM WARDENS units have the following ability:\n**Shade Ward:** This unit has a 5+ invulnerable save.\nFriendly MONSTER units benefit from the Shade Ward rule.";
    const list = placed(text, WARDENS, header("have the following ability", "one"), label("Shade Ward", "Shade Ward"),
      ["This unit has a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
      ["Friendly MONSTER units", "unit-filter", { side: "friendly", keywords: ["MONSTER"] }],
      ["benefit from the Shade Ward rule", "ability-record-grant", { subject: "antecedent", ability: "shade-ward" }]);
    const result = compileLeaves(list, text, { abilityId: "shade-ward" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.mechanics.effect)).toContain('"modifier":{"ability":"shade-ward"}');
  });
});
