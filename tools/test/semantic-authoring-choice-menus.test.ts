import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters, familyRole } from "../src/semantic-authoring/contracts.js";
import { bindAdditiveOptions } from "../src/semantic-authoring/compile-additive-option.js";
import { keywordRef } from "../src/semantic-authoring/compile-fragments.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { sentenceSegments } from "../src/semantic-authoring/compile-segments.js";
import { createValidator } from "../src/schema-loader.js";

/*
 * Fabricated wording. The activation names a sample option; the qualifier, printed after the
 * duration, adds it to the options already active. Each case pins one refusal or the fold itself.
 */

const TEXT = "Sample hero: select one sample option to be active for this unit until the start of your next Command phase, in addition to any other sample option.";
type Piece = [phrase: string, family: string, parameters: Record<string, unknown>, role?: string];

const ACTIVATE: Piece = ["select one sample option to be active for this unit", "ability-activate", { subject: "this-unit", ability: "sample-options-ability", choose: { count: 1 } }];
const DURATION: Piece = ["until the start of your next Command phase", "duration", { endpoint: "start-of-next-command-phase" }];
const QUALIFIER: Piece = ["in addition to any other sample option", "additive-option", {}];

function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, family_id, parameters, role]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at));
    const roleOf = role ?? (family_id === "duration" ? "DURATION" : family_id === "additive-option" ? "CONDITION" : "EFFECT");
    return {
      role: roleOf, family_id, family_version: currentFamilyVersion(family_id), parameters,
      start_byte, end_byte: start_byte + Buffer.byteLength(phrase), fragment: "RAW_TEXT",
    };
  });
}

function refused(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(leavesIn(text, pieces), text);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("additive option qualifier", () => {
  it("folds onto the activation before it, past its duration", () => {
    const result = compileLeaves(leavesIn(TEXT, [ACTIVATE, DURATION, QUALIFIER]), TEXT);
    expect(result.ok).toBe(true);
    // Additive means no exclusive: the other options stay active alongside this one.
    expect(JSON.stringify(result.ok ? result.mechanics : {})).not.toContain("exclusive");
  });

  it("keeps the activation exclusive when no qualifier is printed", () => {
    const plain = compileLeaves(leavesIn(TEXT, [ACTIVATE, DURATION]), TEXT);
    expect(plain.ok).toBe(true);
    expect(JSON.stringify(plain.ok ? plain.mechanics : {})).toContain("exclusive");
  });

  it("refuses when no activation precedes it in its clause", () => {
    const errors = refused(TEXT, [DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/no activation before it/);
  });

  it("refuses when the nearest effect is not an ability-activate", () => {
    const errors = refused(TEXT, [["select one sample option to be active for this unit", "stance-select-open", { options: ["a", "b"] }], DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/no additive form/);
  });

  it("refuses an activation that already keeps every option active", () => {
    const allOptions: Piece = [ACTIVATE[0], ACTIVATE[1], { subject: "this-unit", ability: "sample-options-ability", all_options: true }];
    const errors = refused(TEXT, [allOptions, DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/cannot apply|additive/);
  });

  it("refuses two qualifiers that claim one activation", () => {
    const text = `${TEXT} In addition to any other sample option.`;
    const errors = refused(text, [ACTIVATE, DURATION, QUALIFIER, ["In addition to any other sample option", "additive-option", {}]]);
    expect(errors.join(" ")).toMatch(/claim one activation/);
  });

  it("refuses a sentence stop between the duration and the qualifier", () => {
    const text = "Sample hero: select one sample option to be active for this unit until the start of your next Command phase. In addition to any other sample option.";
    const errors = refused(text, [ACTIVATE, DURATION, ["In addition to any other sample option", "additive-option", {}]]);
    expect(errors.join(" ")).toMatch(/more than its duration/);
  });

  it("refuses a qualifier separated from its activation by an event", () => {
    const text = "Sample hero: select one sample option to be active for this unit at the start of your Command phase until the start of your next Command phase, in addition to any other sample option.";
    const errors = refused(text, [ACTIVATE, ["at the start of your Command phase", "event", {}, "EVENT"], DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/separated from its activation by event/);
  });

  it("refuses a qualifier in a clause with no effect (the Orders shape)", () => {
    const text = "Sample squad: once per battle round, you can select one order to affect this unit until the start of your next Command phase, in addition to any other order.";
    const errors = refused(text, [DURATION, ["in addition to any other order", "additive-option", {}]]);
    expect(errors.join(" ")).toMatch(/no activation before it/);
  });

  it("needs source text to check its clause", () => {
    expect(() => bindAdditiveOptions(leavesIn(TEXT, [ACTIVATE, DURATION, QUALIFIER]))).toThrow(/needs source text/);
  });

  it("takes no parameters, so an extra key fails normalization", () => {
    expect(() => normalizeFingerprintParameters("additive-option", { keyword: "x" }, 1)).toThrow(/parameters must be exactly/);
  });
});

/*
 * A unit-filter between the activation and its qualifier names the activation's units ("that sample option is
 * active for friendly SAMPLE units, in addition to any other sample option"). Fabricated wording throughout.
 */
const FILTER_TEXT = "Sample hero: select one sample option to be active for friendly SAMPLE units until the start of your next Command phase, in addition to any other sample option.";
const CHOSEN: Piece = ["select one sample option to be active for", "ability-activate", { subject: "this-unit", ability: "sample-options-ability", choose: { count: 1 } }];
const SAMPLE_UNITS: Piece = ["friendly SAMPLE units", "unit-filter", { side: "friendly", keywords: ["SAMPLE"] }, "CONDITION"];

describe("additive option with a unit-filter between activation and qualifier", () => {
  it("folds the filter onto the activation as its recipients, and drops the filter leaf", () => {
    const result = compileLeaves(leavesIn(FILTER_TEXT, [CHOSEN, SAMPLE_UNITS, DURATION, QUALIFIER]), FILTER_TEXT);
    expect(result.ok ? true : result.errors).toBe(true);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain('"SAMPLE"');
    expect(json).not.toContain("exclusive");
  });

  it("refuses a filter when the activation already names its own units", () => {
    const errors = refused(FILTER_TEXT, [["select one sample option to be active for", "ability-activate", { subject: "selected-unit", ability: "sample-options-ability", choose: { count: 1 } }], SAMPLE_UNITS, DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/names its own units/);
  });

  it("refuses two filters between the activation and its qualifier", () => {
    const text = "Sample hero: select one sample option to be active for friendly SAMPLE units and enemy SAMPLE units until the start of your next Command phase, in addition to any other sample option.";
    const errors = refused(text, [CHOSEN, ["friendly SAMPLE units", "unit-filter", { side: "friendly", keywords: ["SAMPLE"] }, "CONDITION"], ["enemy SAMPLE units", "unit-filter", { side: "enemy", keywords: ["SAMPLE"] }, "CONDITION"], DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/only a duration/);
  });

  it("refuses a select-unit between the activation and its qualifier", () => {
    const errors = refused(FILTER_TEXT, [CHOSEN, ["friendly SAMPLE units", "select-unit", { scope: "friendly", distance: "any" }], DURATION, QUALIFIER]);
    expect(errors.join(" ")).toMatch(/no additive form|only a duration/);
  });
});

{
  // Fabricated wording only. Keyword names are game keywords; everything else is invented. The
  // compiler reads the punctuation, bullets and joining words between leaves, so each case keeps the
  // structure of a real ability.

  const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
  const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
    .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

  type Piece = [phrase: string, role: string, family: string, parameters: Record<string, unknown>];

  /** Leaves at the byte offsets of their phrases in the text, as the workbench stores them. */
  function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
    let cursor = 0;
    return pieces.map(([phrase, role, family_id, parameters]) => {
      const at = text.indexOf(phrase, cursor);
      if (at < 0) throw new Error(`Missing ${phrase}`);
      cursor = at + phrase.length;
      const start_byte = Buffer.byteLength(text.slice(0, at));
      return { role, family_id, family_version: currentFamilyVersion(family_id), parameters, start_byte, end_byte: start_byte + Buffer.byteLength(phrase), fragment: "RAW_TEXT" };
    });
  }

  const failures = (text: string, pieces: Piece[]): string[] => {
    const result = compileLeaves(leavesIn(text, pieces), text);
    return result.ok ? [] : result.errors;
  };

  function compiled(text: string, pieces: Piece[]) {
    const result = compileLeaves(leavesIn(text, pieces), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const check = checkEntry(entryWithMechanics(base, result.mechanics));
    expect(check.errors).toEqual([]);
    return result;
  }

  const grant = (keywords: string[], extra: Record<string, unknown> = {}) => ({
    type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: keywords.map((keyword) => keywordRef(keyword)), ...extra },
  });
  /** A keyword leaf: its wording in brackets, and the keyword name the compiler grants. */
  const keyword = (name: string, granted = name.replace(/\b\w+/g, (word) => word[0] + word.slice(1).toLowerCase())): Piece => [`[${name}]`, "EFFECT", "weapon-ability-keyword", { keyword: granted }];
  const duration: Piece = ["Until the end of the phase", "DURATION", "duration", { endpoint: "end-of-phase" }];
  const frame = (phrase: string): Piece => [phrase, "EFFECT", "weapon-ability-grant", { subject: "this-unit", weapon_type: "all" }];
  const plus = (roll: string): Record<string, unknown> => ({ roll, operation: "add", value: 1 });

  describe("Semantic authoring choice-open over a keyword menu", () => {
    // 6314 shape: the opener, the menu, the duration and the grant are one sentence's worth of leaves.
    const menuText = "Select either the [LETHAL HITS] or [SUSTAINED HITS 1] ability. Until the end of the phase, weapons equipped by models in your unit have the selected ability.";
    const menu: Piece[] = [
      ["Select either the", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1 }],
      keyword("LETHAL HITS"),
      keyword("SUSTAINED HITS 1"),
      duration,
      frame("weapons equipped by models in your unit have the selected ability"),
    ];

    it("drops the opener so the menu alone is the choice, scoped by the duration", () => {
      const result = compiled(menuText, menu);
      expect(result.mechanics.effect).toEqual({ type: "choice", options: [grant(["Lethal Hits"]), grant(["Sustained Hits 1"])] });
      expect(result.mechanics.scope).toMatchObject({ duration: "phase" });
      expect(result.mechanics.effect).not.toHaveProperty("choice_label");
    });

    it("carries the opener's choice_label onto the menu node", () => {
      const labelled: Piece[] = [[ "Select either the", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1, choice_label: "weapon ability" } ], ...menu.slice(1)];
      expect(compiled(menuText, labelled).mechanics.effect).toEqual({
        type: "choice", choice_label: "weapon ability", options: [grant(["Lethal Hits"]), grant(["Sustained Hits 1"])],
      });
    });

    // 7616 shape: a bulleted menu with three keywords, its trigger in the first sentence.
    it("compiles a bulleted three-keyword menu under a trigger with no opener left behind", () => {
      const text = "Each time this model is selected to fight, select one of the following abilities. Until the end of the phase, this model's ember blades have that ability:\n■ [LETHAL HITS]\n■ [PRECISION]\n■ [SUSTAINED HITS 1]";
      const result = compiled(text, [
        ["is selected to fight", "EVENT", "event", { kind: "selected", to: "fight" }],
        ["select one of the following abilities", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1 }],
        duration,
        ["this model's ember blades have that", "EFFECT", "weapon-ability-grant", { subject: "this-model", weapon_type: "all", weapon_name: "ember blades" }],
        keyword("LETHAL HITS"),
        keyword("PRECISION"),
        keyword("SUSTAINED HITS 1"),
      ]);
      expect(result.mechanics.effect).toEqual({
        type: "choice",
        options: [
          { type: "weapon-ability-grant", target: "this-model", modifier: { keywords: [{ keyword_id: "lethal-hits" }], weapons: { name: "ember blades" } } },
          { type: "weapon-ability-grant", target: "this-model", modifier: { keywords: [{ keyword_id: "precision" }], weapons: { name: "ember blades" } } },
          { type: "weapon-ability-grant", target: "this-model", modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }], weapons: { name: "ember blades" } } },
        ],
      });
      expect(result.mechanics.scope).toMatchObject({ duration: "phase" });
    });

    // Refusals: what a drafter must not get compiled silently.
    it("refuses a single-keyword opener with the at-least-two message", () => {
      const text = "Select either the [LETHAL HITS] ability. Until the end of the phase, weapons equipped by models in your unit have the selected ability.";
      expect(failures(text, [
        ["Select either the", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1 }],
        keyword("LETHAL HITS"),
        duration,
        frame("weapons equipped by models in your unit have the selected ability"),
      ])).toEqual(["choice-open needs at least two options after it, one sentence each."]);
    });

    it("refuses a keyword menu followed by a make-move sentence", () => {
      const text = `${menuText} Make a fabricated move of up to D6.`;
      expect(failures(text, [...menu, ["Make a fabricated move of up to D6", "EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }]]))
        .toEqual(["A choice-open over a keyword menu needs the menu as its only effect."]);
    });

    it("refuses a keyword menu under a random pick", () => {
      expect(failures(menuText, [
        ["Select either the", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1, or_random: { dice: "D6", count: 1 } }],
        keyword("LETHAL HITS"),
        keyword("SUSTAINED HITS 1"),
        duration,
        frame("weapons equipped by models in your unit have the selected ability"),
      ])).toEqual(["A choice-open over a keyword menu needs exactly one choice: min_choices and max_choices both 1, and no random pick."]);
    });

    it("refuses a non-bulleted option that holds a condition", () => {
      const text = "Choose one: add one to hit rolls if the foe is thinned; or add one to wound rolls.";
      expect(failures(text, [
        ["Choose one:", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1 }],
        ["add one to hit rolls", "EFFECT", "roll-modifier", plus("hit")],
        ["if the foe is thinned", "CONDITION", "unit-state", { states: ["below-starting-strength"], subject: "target", negated: false }],
        ["add one to wound rolls", "EFFECT", "roll-modifier", plus("wound")],
      ]).join(" ")).toContain("can only hold effect leaves");
    });

    // A bullet bounds its option, so a sentence break inside it cannot cut the option in two: the condition
    // in the bullet's second sentence gates only that sentence's effect, inside the option.
    it("keeps a bulleted option's later sentence, condition and all, inside that option", () => {
      const text = "Choose one:\n■ Add one to hit rolls. If the foe is thinned, add one to wound rolls.\n■ Add one to save rolls.";
      expect(compiled(text, [
        ["Choose one:", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1 }],
        ["Add one to hit rolls", "EFFECT", "roll-modifier", plus("hit")],
        ["If the foe is thinned", "CONDITION", "unit-state", { states: ["below-starting-strength"], subject: "target", negated: false }],
        ["add one to wound rolls", "EFFECT", "roll-modifier", plus("wound")],
        ["Add one to save rolls", "EFFECT", "roll-modifier", plus("save")],
      ]).mechanics.effect).toEqual({
        type: "choice", min_choices: 1, max_choices: 1,
        options: [
          { type: "sequence", steps: [
            { type: "roll-modifier", target: "this-unit", modifier: plus("hit") },
            { type: "conditional", condition: { type: "strength", parameters: { subject: "defender", below: "starting" } }, effect: { type: "roll-modifier", target: "this-unit", modifier: plus("wound") } },
          ] },
          { type: "roll-modifier", target: "this-unit", modifier: plus("save") },
        ],
      });
    });

    // Hunts: a bullet that opens its own container ("Select one objective marker. …") ended the choice there.
    it("takes a container that opens inside a bullet as that option's own", () => {
      const text = "Choose one:\n■ Add one to hit rolls.\n■ Select one objective marker. While this unit is within range of that objective marker, add one to save rolls.";
      const effect = compiled(text, [
        ["Choose one:", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1 }],
        ["Add one to hit rolls", "EFFECT", "roll-modifier", plus("hit")],
        ["Select one objective marker", "EFFECT", "select-objective-open", { bind_as: "objective-marker", count: 1 }],
        ["While this unit is within range of that objective marker", "CONDITION", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "selected" }],
        ["add one to save rolls", "EFFECT", "roll-modifier", plus("save")],
      ]).mechanics.effect as { type: string; options: Array<Record<string, unknown>> };
      expect(effect.type).toBe("choice");
      expect(effect.options).toHaveLength(2);
      expect(effect.options[1]!.type).toBe("select-objective");
    });

    // Hunts: the line after the last bullet ("In either case, …") was read as more of that bullet.
    it("ends a bulleted choice at the first line after its last bullet", () => {
      const text = "Choose one:\n■ Add one to hit rolls.\n■ Add one to save rolls.\nIn either case, add one to wound rolls.";
      const effect = compiled(text, [
        ["Choose one:", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1 }],
        ["Add one to hit rolls", "EFFECT", "roll-modifier", plus("hit")],
        ["Add one to save rolls", "EFFECT", "roll-modifier", plus("save")],
        ["add one to wound rolls", "EFFECT", "roll-modifier", plus("wound")],
      ]).mechanics.effect as Record<string, unknown>;
      expect(JSON.stringify(effect)).toContain('"options":[{"type":"roll-modifier","target":"this-unit","modifier":{"roll":"hit","operation":"add","value":1}},{"type":"roll-modifier","target":"this-unit","modifier":{"roll":"save","operation":"add","value":1}}]');
      expect(JSON.stringify(effect).match(/"roll":"wound"/gu)).toHaveLength(1);
    });

    // Non-regression: effects-only bulleted options with full stops compile as before.
    it("keeps two bulleted effect-only options, each ending in a full stop, as a two-option choice", () => {
      const text = "Choose one:\n■ Add one to hit rolls.\n■ Add one to wound rolls.";
      expect(compiled(text, [
        ["Choose one:", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1 }],
        ["Add one to hit rolls", "EFFECT", "roll-modifier", plus("hit")],
        ["Add one to wound rolls", "EFFECT", "roll-modifier", plus("wound")],
      ]).mechanics.effect).toEqual({
        type: "choice", min_choices: 1, max_choices: 1,
        options: [
          { type: "roll-modifier", target: "this-unit", modifier: plus("hit") },
          { type: "roll-modifier", target: "this-unit", modifier: plus("wound") },
        ],
      });
    });
  });

  describe("Semantic authoring bulleted choice-open with a move option", () => {
    // 6834 shape: each bullet is one option; the second option carries a move-must-end and a position
    // condition with no full stop between them, so only the bullet separates the options.
    const text = "If this unit is not within Engagement Range of one or more enemy units, it can do one of the following:\n■ Make a fabricated move of up to D6\n■ Make a fabricated move of up to 6, provided every model in this unit ends that move wholly within 6\" of one or more friendly FABRICATED BATTLELINE units";
    const leaves: Piece[] = [
      ["this unit is not within Engagement Range", "CONDITION", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }],
      ["do one of the following", "EFFECT", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["Make a fabricated move of up to D6", "EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["Make a fabricated move of up to 6", "EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }],
      ["provided every model in this unit ends that move", "RESTRICTION", "move-must-end", { match: "all" }],
      ["wholly within 6\" of one or more friendly FABRICATED BATTLELINE units", "CONDITION", "unit-position", { kind: "within", inches: 6, of: "matching-unit", subject: "this-unit", negated: false, of_keywords: ["FABRICATED BATTLELINE"], of_side: "friendly", wholly: true }],
    ];

    it("compiles each bullet as one option, the second with its move end", () => {
      const result = compiled(text, leaves);
      // The unit's own engagement condition wraps the whole choice.
      const wrapped = result.mechanics.effect as { type: string; effect: unknown };
      expect(wrapped.type).toBe("conditional");
      const effect = wrapped.effect as { type: string; options: Array<{ type: string; modifier: Record<string, unknown> }> };
      expect(effect.type).toBe("choice");
      expect(effect.options).toHaveLength(2);
      expect(effect.options[0]!.type).toBe("move");
      expect(effect.options[0]!.modifier).not.toHaveProperty("ends_when");
      expect(effect.options[1]!.type).toBe("move");
      expect(effect.options[1]!.modifier).toHaveProperty("ends_when");
    });

    it("refuses the same options when the second one's move end has no bullet before it", () => {
      const flat = text.replaceAll("\n■ ", " and ");
      expect(failures(flat, leaves)).toEqual(["choice-open needs at least two options after it, one sentence each."]);
    });
  });

  describe("Semantic authoring keyword menu recalled by a later choice", () => {
    const leaf = (phrase: string, family: string, parameters: Record<string, unknown>): Piece => [phrase, familyRole(family, currentFamilyVersion(family)), family, parameters];
    const melee = (phrase: string): Piece => leaf(phrase, "weapon-ability-grant", { subject: "this-unit", weapon_type: "melee" });
    const phase = leaf("until the end of the phase", "duration", { endpoint: "end-of-phase" });
    const text = (menu: string, pick: string) => "Each time this unit is selected to fight, select one of the following abilities for melee weapons equipped by models in this unit to gain until the end of the phase:\n"
      + `${menu}\nIf this unit made a Charge move this turn, until the end of the phase, select ${pick} for melee weapons equipped by models in this unit to gain instead.`;
    const pieces = (keywords: Piece[], pick: Piece): Piece[] => [
      leaf("Each time this unit is selected to fight", "event", { kind: "selected", to: "fight" }),
      leaf("select one of the following abilities", "choice-open", { min_choices: 1, max_choices: 1 }),
      melee("for melee weapons equipped by models in this unit to gain"),
      phase,
      ...keywords,
      leaf("If this unit made a Charge move this turn", "unit-activity", { activities: ["charged-this-turn"], subject: "this-unit", negated: false }),
      phase,
      pick,
      melee("for melee weapons equipped by models in this unit to gain"),
      leaf("instead", "instead", {}),
    ];

    it("grants every option of the menu above when the later choice picks all of them", () => {
      const result = compiled(text("■ [LETHAL HITS]\n■ [DEVASTATING WOUNDS]", "both abilities above"), pieces(
        [keyword("LETHAL HITS"), keyword("DEVASTATING WOUNDS")],
        leaf("select both abilities above", "choice-open", { choice_label: "abilities above", min_choices: 2, max_choices: 2 }),
      ));
      const melee = { weapons: { type: "melee" } };
      const charged = { type: "happened", parameters: { event: "move-ended", filter: { move_types: ["charge"] }, window: "turn" } };
      expect(result.ok && result.mechanics.scope).toEqual({ duration: "phase" });
      expect(result.ok && result.mechanics.effect).toEqual({ type: "sequence", steps: [
        { type: "conditional", condition: { operator: "not", operands: [charged] }, effect: { type: "choice", options: [grant(["Lethal Hits"], melee), grant(["Devastating Wounds"], melee)] } },
        { type: "conditional", condition: charged, effect: grant(["Lethal Hits", "Devastating Wounds"], melee) },
      ] });
    });

    it("refuses a later choice that picks some but not all of the menu above", () => {
      expect(failures(text("■ [LETHAL HITS]\n■ [DEVASTATING WOUNDS]\n■ [SUSTAINED HITS 1]", "two abilities above"), pieces(
        [keyword("LETHAL HITS"), keyword("DEVASTATING WOUNDS"), keyword("SUSTAINED HITS 1", "Sustained Hits 1")],
        leaf("select two abilities above", "choice-open", { choice_label: "abilities above", min_choices: 2, max_choices: 2 }),
      )).join(" ")).toContain("picks 2 of the 3 weapon abilities");
    });

    it("leaves a menu unclaimed when a sentence ends between the frame's duration and the keywords", () => {
      const unbulleted = "Each time this unit is selected to fight, select one of the following abilities for melee weapons equipped by models in this unit to gain until the end of the phase. It is [LETHAL HITS] or [DEVASTATING WOUNDS].";
      expect(failures(unbulleted, [
        leaf("Each time this unit is selected to fight", "event", { kind: "selected", to: "fight" }),
        leaf("select one of the following abilities", "choice-open", { min_choices: 1, max_choices: 1 }),
        melee("for melee weapons equipped by models in this unit to gain"),
        phase,
        keyword("LETHAL HITS"), keyword("DEVASTATING WOUNDS"),
      ]).join(" ")).toContain("needs weapon-ability-keyword leaves");
    });
  });
}

/**
 * Effects on the units a filter names while they carry a designation, a menu those units hold
 * ("that unit has the effect of your chosen Hex"), and the parts a record with a deployment-time
 * menu splits into. Every text here is fabricated wording, not rules text.
 */

type Item = [string, string, Record<string, unknown>, number?];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, pinned]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = pinned ?? currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, any>;
}

const ajv = createValidator();
const effectOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
const MARKED = { owner: "enemy", designated: "afflicted" };

const persistent: Item[] = [
  ["Until the end of the battle", "duration", { endpoint: "end-of-battle" }],
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ["Marked", "designated-filter", { tag: "afflicted" }],
  ["subtract 1 from the Toughness characteristic of models in that unit", "characteristic-modifier", { subject: "antecedent", characteristics: ["T"], operation: "subtract", value: 1, weapon_type: "all" }],
];

describe("an effect on the units a filter names while they carry a designation", () => {
  it("narrows the filter by the designation instead of refusing the filter", () => {
    const text = "Until the end of the battle, while an enemy unit is Marked, subtract 1 from the Toughness characteristic of models in that unit.";
    const mechanics = mechanicsOf(text, ...persistent);
    expect(mechanics.effect).toEqual({ type: "stat-modifier", target: MARKED, modifier: { stat: "T", operation: "subtract", value: 1 } });
    expect(mechanics.scope).toEqual({ duration: "battle" });
  });
});

describe("a menu the units of a filter hold", () => {
  const text = "At the start of the battle, select one of the Hexes below. Until the end of the battle, while an enemy unit is Marked, "
    + "subtract 1 from the Toughness characteristic of models in that unit, and that unit has the effect of your chosen Hex. "
    + "Hex of Rust: Each time a model in this unit makes a ranged attack, enemy units have the benefit of cover against the attack. "
    + "Hex of Lead: Worsen the Move characteristic of models in this unit by 1.";
  const items: Item[] = [
    ["At the start of the battle", "event", { kind: "battle-formations-declared" }],
    ["select one of the Hexes below", "choice-open", { choice_label: "hex", min_choices: 1, max_choices: 1 }],
    ...persistent,
    ["that unit has the effect of your chosen Hex", "chosen-option-grant", { holder: "antecedent" }],
    ["Hex of Rust", "named-option", { label: "Hex of Rust" }],
    ["Each time a model in this unit makes a ranged attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
    ["enemy units have the benefit of cover against the attack", "core-ability-grant", { subject: "target", ability: "benefit-of-cover" }],
    ["Hex of Lead", "named-option", { label: "Hex of Lead" }],
    ["Worsen the Move characteristic of models in this unit by 1", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "worsen", value: 1, weapon_type: "all" }],
  ];

  it("gives every option to the designated units, and keeps the sentence that grants them out of the options", () => {
    const effect = mechanicsOf(text, ...items).effect;
    expect(effectOk(effect), JSON.stringify(effectOk.errors)).toBe(true);
    const [choice, toughness] = effect.steps;
    // The leading sentence is not a third option, and its own effect stays beside the menu.
    expect(choice.options).toHaveLength(2);
    expect(toughness).toEqual({ type: "stat-modifier", target: MARKED, modifier: { stat: "T", operation: "subtract", value: 1 } });
    // Before the holder bound to the filter, each option stayed on the record's own unit.
    expect(choice.options[1]).toEqual({ type: "stat-modifier", target: MARKED, modifier: { stat: "M", operation: "worsen", value: 1 } });
    // An option's own attacks are the holder's: the attack-type gate names them as the attacker.
    expect(choice.options[0]).toEqual({
      type: "conditional",
      condition: { operator: "and", operands: [{ type: "attack-is", parameters: { attack_type: "ranged" } }, { type: "matches", parameters: { filter: MARKED, subject: "attacker" } }] },
      effect: { type: "ability-grant", target: "defender", modifier: { ability: "benefit-of-cover" } },
    });
  });
});

describe("a record with an aura and a deployment-time menu", () => {
  const text = "While an enemy unit is within 6\" of this model, it is Marked.\n**Hexes**\n"
    + "During the Declare Battle Formations step, select one of the Hexes below. Until the end of the battle, while an enemy unit is Marked, "
    + "subtract 1 from the Toughness characteristic of models in that unit, and that unit has the effect of your chosen Hex.\n"
    + "**Hex of Rust**\nEach time a model in this unit makes a ranged attack, enemy units have the benefit of cover against the attack.\n"
    + "**Hex of Lead**\nWorsen the Move characteristic of models in this unit by 1.";
  const leaves = placed(text,
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
    ["it is Marked", "apply-mark", { subject: "antecedent", tag: "afflicted" }],
    ["During the Declare Battle Formations step", "event", { kind: "battle-formations-declared" }],
    ["select one of the Hexes below", "choice-open", { choice_label: "hex", min_choices: 1, max_choices: 1 }],
    ...persistent,
    ["that unit has the effect of your chosen Hex", "chosen-option-grant", { holder: "antecedent" }],
    ["Hex of Rust", "named-option", { label: "Hex of Rust" }],
    ["Each time a model in this unit makes a ranged attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
    ["enemy units have the benefit of cover against the attack", "core-ability-grant", { subject: "target", ability: "benefit-of-cover" }],
    ["Hex of Lead", "named-option", { label: "Hex of Lead" }],
    ["Worsen the Move characteristic of models in this unit by 1", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "worsen", value: 1, weapon_type: "all" }],
  );

  it("splits at the deployment moment past a bold heading, and not at an option's own moment", () => {
    const parts = sentenceSegments(leaves, text);
    expect(parts?.map((part) => part.map((leaf) => leaf.family_id)[0])).toEqual(["unit-filter", "event"]);
    expect(parts![1]!.some((leaf) => leaf.family_id === "attack")).toBe(true);
  });

  it("compiles the aura and the menu as two parts", () => {
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const [aura, menu] = (result.mechanics.effect as Record<string, any>).steps;
    expect(aura.type).toBe("aura");
    expect(menu).toMatchObject({ type: "ability-part", trigger: { event: "battle-formations-declared" }, duration: "battle" });
    expect(menu.effect.steps[0].options).toHaveLength(2);
  });
});

describe("core-ability-grant@5", () => {
  it("names the attack's target as the recipient and keeps earlier subjects", () => {
    expect(normalizeFingerprintParameters("core-ability-grant", { subject: "target", ability: "benefit-of-cover" }, 5)).toEqual({ subject: "target", ability: "benefit-of-cover" });
    expect(() => normalizeFingerprintParameters("core-ability-grant", { subject: "target", ability: "benefit-of-cover" }, 4)).toThrow();
    expect(normalizeFingerprintParameters("core-ability-grant", { subject: "this-unit", ability: "stealth" }, 5))
      .toEqual(normalizeFingerprintParameters("core-ability-grant", { subject: "this-unit", ability: "stealth" }, 4));
  });
});
