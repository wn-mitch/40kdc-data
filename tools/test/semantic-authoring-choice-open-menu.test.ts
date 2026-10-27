import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { keywordRef } from "../src/semantic-authoring/compile-fragments.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";

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
