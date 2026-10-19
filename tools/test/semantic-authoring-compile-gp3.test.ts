import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

// Fabricated wording only. The compiler reads the punctuation and joining words between leaves,
// so each shape keeps the structure of a record with invented words.

type Piece = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
}

function mechanicsOf(text: string, pieces: Piece[]): Record<string, any> {
  const result = compileLeaves(placed(text, pieces), text);
  if (!result.ok) throw new Error(`expected a compiled record, got: ${result.errors.join(" | ")}`);
  return result.mechanics;
}

function errorsOf(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(placed(text, pieces), text);
  return result.ok ? [] : result.errors;
}

const stat = (characteristic: string, value: number): Record<string, unknown> => ({ subject: "this-unit", characteristics: [characteristic], operation: "add", value });
const keyword = (word: string, subject = "this-unit"): Record<string, unknown> => ({ keywords: [word], subject, negated: false });
const hasKeyword = (word: string) => ({ type: "matches", parameters: { filter: { all_of: [word] } } });
const notShocked = { operator: "not", operands: [{ type: "matches", parameters: { filter: { state: "battle-shocked" } } }] };
const shockedState: Record<string, unknown> = { states: ["battle-shocked"], subject: "this-unit", negated: true };

describe("an If-led sentence gates its own sentence only (compile-instead-scope.ts sentenceIfGates)", () => {
  it("scopes each If-led list item's condition to its own item", () => {
    const text = "While this unit is calm: If this unit has KEYA, this unit has +1 OC. If this unit has KEYB, this unit has +3 OC.";
    const mechanics = mechanicsOf(text, [
      ["While this unit is calm", "unit-state", shockedState],
      ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
      ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
      ["If this unit has KEYB", "unit-keyword", keyword("KEYB")],
      ["this unit has +3 OC", "characteristic-modifier", stat("OC", 3)],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: notShocked, effect: { type: "sequence", steps: [
      { type: "conditional", condition: hasKeyword("KEYA"), effect: { type: "stat-modifier", modifier: { value: 1 } } },
      { type: "conditional", condition: hasKeyword("KEYB"), effect: { type: "stat-modifier", modifier: { value: 3 } } },
    ] } });
  });

  it("stops an If-led condition at its sentence when a later sentence opens a moment", () => {
    const text = "At the start of the phase. If it is a KEYA unit, it has +1 OC. When this unit is set up, if it is a KEYB unit it has +2 OC.";
    const mechanics = mechanicsOf(text, [
      ["At the start of the phase", "event", { kind: "phase-start", phase: "any" }],
      ["If it is a KEYA unit", "unit-keyword", keyword("KEYA", "antecedent")],
      ["it has +1 OC", "characteristic-modifier", stat("OC", 1)],
      ["When this unit is set up", "event", { kind: "set-up" }],
      ["if it is a KEYB unit", "unit-keyword", keyword("KEYB", "antecedent")],
      ["it has +2 OC", "characteristic-modifier", stat("OC", 2)],
    ]);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps[0]).toMatchObject({ type: "ability-part", effect: { type: "conditional", condition: hasKeyword("KEYA") } });
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "set-up" }, effect: { type: "conditional", condition: hasKeyword("KEYB") } });
  });

  it("keeps the ability-wide gate when the next sentence only continues the first", () => {
    const text = "If this unit has KEYA, this unit has +1 OC. This unit has +3 M.";
    const mechanics = mechanicsOf(text, [
      ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
      ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
      ["This unit has +3 M", "characteristic-modifier", stat("M", 3)],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA"), effect: { type: "sequence" } });
  });

  it("keeps the gate on a colon-introduced list", () => {
    const text = "If this unit has KEYA, this unit gets these:\n■ If this unit has KEYB, this unit has +1 OC.";
    const mechanics = mechanicsOf(text, [
      ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
      ["this unit gets these", "characteristic-modifier", stat("OC", 2)],
      ["If this unit has KEYB", "unit-keyword", keyword("KEYB")],
      ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA") });
  });
});

describe("a roll's pre-roll conditions gate every result band (compile-roll-gates.ts)", () => {
  const rolled: Piece[] = [
    ["This unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
    ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["On a 1-4", "roll-result", { from: 1, to: 4 }],
    ["this unit has -2 M", "characteristic-modifier", { ...stat("M", 2), operation: "subtract" }],
    ["On a 5-6", "roll-result", { from: 5, to: 6 }],
    ["this unit has -3 M", "characteristic-modifier", { ...stat("M", 3), operation: "subtract" }],
  ];
  const outcomes = (text: string, pieces: Piece[]) => mechanicsOf(text, pieces).effect.steps[1].outcomes as Array<Record<string, any>>;

  it("gates the band after a full stop by the conditions before the roll", () => {
    const text = "This unit has +1 OC. If this unit has KEYA, roll one D6: On a 1-4, this unit has -2 M. On a 5-6, this unit has -3 M.";
    const [low, high] = outcomes(text, rolled);
    expect(low!.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA") });
    expect(high!.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA"), effect: { type: "stat-modifier", modifier: { value: 3 } } });
  });

  it("leaves a condition printed after the roll with its own band", () => {
    const text = "This unit has +1 OC. Roll one D6: On a 1-4, if this unit has KEYB, this unit has -2 M. On a 5-6, this unit has -3 M.";
    const [low, high] = outcomes(text, [rolled[0]!, ["Roll one D6", "dice-roll", { dice: "D6" }], rolled[3]!, ["if this unit has KEYB", "unit-keyword", keyword("KEYB")], rolled[4]!, rolled[5]!, rolled[6]!]);
    expect(low!.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYB") });
    expect(high!.effect).toMatchObject({ type: "stat-modifier", modifier: { value: 3 } });
  });

  it("does not carry a roll's conditions to the bands of a later roll", () => {
    const text = "This unit has +1 OC. If this unit has KEYA, roll one D6: On a 1-4, this unit has -2 M. When this unit is set up, roll one D6: On a 5-6, this unit has -3 M.";
    const result = mechanicsOf(text, [
      rolled[0]!, rolled[1]!, rolled[2]!, rolled[3]!, rolled[4]!,
      ["When this unit is set up", "event", { kind: "set-up" }],
      ["roll one D6", "dice-roll", { dice: "D6" }], rolled[5]!, rolled[6]!,
    ]);
    const later = JSON.stringify(result.effect.steps.at(-1));
    expect(later).toContain("-3".replace("-", "")); // the second roll's band compiled
    expect(later).not.toContain("KEYA");
  });
});

describe("a standing grant sentence is its own part (compile-segments.ts standingGrant)", () => {
  const text = "When a friendly KEYA unit is selected to move, that move does not stop that unit from charging. Friendly KEYA units have the following ability:\n**Zeal:** this unit has +1 OC.";
  const pieces: Piece[] = [
    ["friendly KEYA unit", "unit-filter", { side: "friendly", keywords: ["KEYA"] }],
    ["selected to move", "event", { kind: "selected", to: "move" }],
    ["that move does not stop that unit from charging", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true }],
    ["Friendly KEYA units", "unit-filter", { side: "friendly", keywords: ["KEYA"] }],
    ["have the following ability", "ability-record-grant", { subject: "antecedent", printed: "one" }],
    ["Zeal", "granted-ability-name", { label: "Zeal" }],
    ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
  ];

  it("keeps the grant out of the earlier sentence's moment", () => {
    const mechanics = mechanicsOf(text, pieces);
    expect(mechanics.trigger).toBeNull();
    expect(mechanics.effect.steps[0]).toMatchObject({ type: "ability-part", trigger: { event: "selected" }, effect: { type: "permission" } });
    expect(mechanics.effect.steps[1]).toMatchObject({ type: "ability-grant", target: { owner: "friendly", all_of: ["KEYA"] } });
    expect(mechanics.effect.steps[1].trigger).toBeUndefined();
  });

  it("leaves a grant with no earlier moment as the record's own", () => {
    const bare = "Friendly KEYA units have the following ability:\n**Zeal:** this unit has +1 OC.";
    const mechanics = mechanicsOf(bare, pieces.slice(3));
    expect(mechanics.effect).toMatchObject({ type: "ability-grant" });
  });
});

describe("an Or: choice between keyword grants keeps each option's own condition (compile-weapon-keywords.ts)", () => {
  const text = "This unit's attacks:Have [LETHAL HITS], if this unit is calm. Or: have [SUSTAINED HITS 1], if this unit is rattled.";
  const frame = { subject: "this-unit", weapon_type: "all" };
  const pieces: Piece[] = [
    ["This unit's attacks", "weapon-ability-grant", frame],
    ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ["if this unit is calm", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: true }],
    ["Or", "instead", { choice: true }],
    ["have", "weapon-ability-grant", frame],
    ["SUSTAINED HITS 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }],
    ["if this unit is rattled", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: false }],
  ];
  const rattled = { type: "matches", parameters: { filter: { state: "battle-shocked" } } };

  it("gates the first option by its own trailing condition and the second by its own", () => {
    const options = mechanicsOf(text, pieces).effect.options as Array<Record<string, any>>;
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({ type: "conditional", condition: { operator: "not", operands: [rattled] }, effect: { modifier: { keywords: [{ keyword_id: "lethal-hits" }] } } });
    expect(options[1]).toMatchObject({ type: "conditional", condition: rattled, effect: { modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }] } } });
  });

  it("still refuses a keyword run with no frame to grant it", () => {
    const frameless = pieces.filter((piece) => piece[0] !== "have");
    expect(errorsOf(text, frameless)).toEqual(["A weapon-ability-keyword leaf has no weapon-ability-grant frame saying which weapons gain it."]);
  });
});

describe("a phase end after a destruction nests under it (compile-nested-moment.ts, compile-delayed-destruction.ts)", () => {
  const roll: Piece[] = [
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["on a 2+", "roll-result", { from: 2 }],
    ["set this model back up on the battlefield", "set-up", { subject: "this-model", to: "battlefield" }],
  ];
  const text = "The first time this model is destroyed, remove it from play. Then, at the end of the phase, roll one D6: on a 2+, set this model back up on the battlefield.";
  const head: Piece[] = [
    ["The first time", "usage-limit", { frequency: "first-this-battle", per: "model" }],
    ["this model is destroyed", "event", { kind: "this-model-destroyed" }],
    ["remove it from play", "destroy-models", { recipient: "this-model", count: "1", remove_from_play: true }],
    ["at the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
    ...roll,
  ];

  it("nests the end of that phase in the destruction's part", () => {
    const mechanics = mechanicsOf(text, head);
    expect(mechanics.usage).toEqual({ frequency: "first-this-battle", per: "model" });
    expect(mechanics.effect).toMatchObject({ type: "ability-part", trigger: { event: "model-destroyed" }, effect: { type: "sequence", steps: [
      { type: "destroy-models" },
      { type: "ability-part", trigger: { event: "phase-ended" }, duration: "phase", effect: { type: "dice-gated" } },
    ] } });
  });

  it("refuses a first-time destruction with no usage limit", () => {
    const errors = errorsOf(text, head.filter((piece) => piece[1] !== "usage-limit"));
    expect(errors).toEqual(["A \"first time\" limit with no usage limit has no DSL form; the ability would fire on every destruction."]);
  });

  it("keeps a phase end that names its phase as a sibling part", () => {
    const named = text.replace("at the end of the phase", "at the end of your Fight phase");
    const pieces = head.map((piece): Piece => piece[0] === "at the end of the phase" ? ["at the end of your Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "your" }] : piece);
    const steps = mechanicsOf(named, pieces).effect.steps as Array<Record<string, any>>;
    expect(steps.map((step) => step.trigger.event)).toEqual(["model-destroyed", "phase-ended"]);
  });

  it("nests a named model's destruction followed by the end of the phase in the same sentence", () => {
    const named = "The first time a model in this unit is destroyed, roll one D6 at the end of the phase. On a 2+, set this model back up on the battlefield.";
    const pieces: Piece[] = [
      ["The first time", "usage-limit", { frequency: "first-this-battle", per: "model" }],
      ["a model in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["at the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["set this model back up on the battlefield", "set-up", { subject: "this-model", to: "battlefield" }],
    ];
    const mechanics = mechanicsOf(named, pieces);
    expect(mechanics.trigger).toMatchObject({ event: "model-destroyed" });
    expect(mechanics.effect).toMatchObject({ type: "ability-part", trigger: { event: "phase-ended" }, duration: "phase", effect: { type: "dice-gated" } });
  });

  it("still refuses a named model's repeated destruction followed by the end of the phase", () => {
    const named = "Each time a model in this unit is destroyed, roll one D6 at the end of the phase. On a 2+, set this model back up on the battlefield.";
    const errors = errorsOf(named, [
      ["a model in this unit is destroyed", "event", { kind: "model-destroyed" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["at the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["set this model back up on the battlefield", "set-up", { subject: "this-model", to: "battlefield" }],
    ]);
    expect(errors.join(" ")).toContain("has no DSL form");
  });
});

describe("a reserves arrival pairs with a set-up in an earlier sentence of its own option (compile.ts)", () => {
  const text = "Choose one of these options:\n**Alpha**\nIn your Command phase, if this unit is unengaged, you can use this ability. If you do:\n- Place this unit in reserves.\n- This unit can make an ingress move in your next Movement phase (including in your first turn).\n**Beta**\nThis unit has +1 OC.";
  const pieces: Piece[] = [
    ["Choose one of these options", "choice-open", { choice_label: "options", min_choices: 1, max_choices: 1 }],
    ["Alpha", "named-option", { label: "Alpha" }],
    ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
    ["if this unit is unengaged", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }],
    ["you can use this ability", "optional-use", { who: "you" }],
    ["Place this unit in reserves", "set-up", { subject: "this-unit", to: "strategic-reserves" }],
    ["This unit can make an ingress move", "make-move", { subject: "this-unit", move_type: "ingress" }],
    ["in your next Movement phase", "phase-window", { phase: "movement", turn: "your" }],
    ["including in your first turn", "reserves-arrival", { allow_first_round: true }],
    ["Beta", "named-option", { label: "Beta" }],
    ["This unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
  ];

  it("binds the arrival to the set-up of the sentence before it", () => {
    const options = mechanicsOf(text, pieces).effect.options as Array<Record<string, any>>;
    const alpha = JSON.stringify(options[0]);
    expect(alpha).toContain('"type":"set-up"');
    expect(alpha).toContain('"arrives":"next-movement-phase"');
    expect(alpha).toContain('"allow_first_round":true');
  });

  it("still refuses an arrival whose option holds no set-up", () => {
    const errors = errorsOf(text, pieces.filter((piece) => piece[0] !== "Place this unit in reserves"));
    expect(errors.join(" ")).toContain("A reserves arrival has no set-up before it.");
  });
});

describe("a weapon scope's recipient chain may stack filters after an attack sentence (compile-weapon-scopes.ts)", () => {
  const text = "Each time a KEYA model from your army makes an attack, add 1 to the Hit roll. In addition, ranged weapons equipped by KEYC models (excluding KEYD models) from your army have the [ASSAULT] ability.";
  const pieces: Piece[] = [
    ["KEYA model", "unit-filter", { side: "friendly", keywords: ["KEYA"], level: "model" }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ["ranged weapons equipped by", "weapon-property-scope", { subject: "antecedent", weapon_type: "ranged" }],
    ["KEYC models", "unit-filter", { side: "friendly", keywords: ["KEYC"], level: "model" }],
    ["excluding KEYD models", "unit-filter", { side: "friendly", excluded_keywords: ["KEYD"], level: "model" }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
  ];
  // The second "from your army" is the one after the exclusion: placed() searches forward from the previous wording.

  it("grants the keyword to the merged recipient filter", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Array<Record<string, any>>;
    expect(steps[1]).toMatchObject({ type: "weapon-ability-grant", target: { owner: "friendly", all_of: ["KEYC"], none_of: ["KEYD"], level: "model" },
      modifier: { keywords: [{ keyword_id: "assault" }], weapons: { type: "ranged" } } });
  });

  it("keeps the stacked filter of a different side out of the chain", () => {
    const enemy: Piece[] = pieces.map((piece): Piece => piece[0] === "excluding KEYD models" ? [piece[0], piece[1], { ...piece[2], side: "enemy" }] : piece);
    expect(errorsOf(text, enemy).length).toBeGreaterThan(0);
  });
});

describe("an instead after a suppressed rule trades it for the effects that follow (compile-cross-family-instead.ts)", () => {
  const text = "This unit does not have the KEYA ability, but instead, each time a model in this unit makes an attack, re-roll the Hit roll and re-roll a Wound roll of 1.";
  const pieces: Piece[] = [
    ["This unit does not have the KEYA ability", "rule-state", { subject: "this-unit", direction: "suppressed", rule_kind: "core-rule", rule: "fights-first" }],
    ["instead", "instead", {}],
    ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }],
    ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
  ];

  it("applies the loss and both re-rolls, each ungated", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Array<Record<string, any>>;
    expect(steps.map((step) => step.type)).toEqual(["rule-state", "re-roll", "re-roll"]);
  });

  it("keeps the refusal when the instead after a suppressed rule has a condition of its own", () => {
    const conditioned = "This unit does not have the KEYA ability, but if this unit has KEYB, re-roll the Hit roll and re-roll a Wound roll of 1 instead.";
    const errors = errorsOf(conditioned, [pieces[0]!, ["if this unit has KEYB", "unit-keyword", keyword("KEYB")], pieces[3]!, pieces[4]!, pieces[1]!]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("keeps the refusal when the effect before instead is not a suppressed rule", () => {
    const other = "This unit has +1 OC, but instead, re-roll the Hit roll and re-roll a Wound roll of 1.";
    const errors = errorsOf(other, [["This unit has +1 OC", "characteristic-modifier", stat("OC", 1)], pieces[1]!, pieces[3]!, pieces[4]!].map((piece, at): Piece => at === 1 ? ["instead", "instead", {}] : piece as Piece));
    expect(errors.join(" ")).toContain("Instead");
  });
});

describe("a window beside a later moment, and a parenthetical's duration (compile-durations.ts, compile.ts)", () => {
  const text = "Until the end of the phase, each time your unit makes a Normal move, you can ignore modifiers to its Move and, until the end of the turn, each time a model in your unit makes such a move, it can move through models (when doing so, such a model cannot end a Normal move within Engagement Range of them).";
  const pieces: Piece[] = [
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["each time your unit makes a Normal move", "event", { kind: "move-ended", move_types: ["normal"] }],
    ["you can", "optional-use", { who: "you" }],
    ["ignore modifiers to its Move", "ignore-modifiers", { subject: "this-unit", what: "characteristics", stats: ["M"] }],
    ["until the end of the turn", "duration", { endpoint: "end-of-turn" }],
    ["each time a model in your unit makes such a move", "event", { kind: "move-ended", move_types: ["normal"] }],
    ["it can move through models", "move-through", { subject: "antecedent", passthrough: "models" }],
    ["cannot end a Normal move", "move-must-end", { match: "all", polarity: "cannot", move_types: ["normal"] }],
    ["within Engagement Range of them", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false }],
  ];

  it("keeps the window as the first moment's lifetime and the later moment's own duration", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: "ability-part", duration: "phase", trigger: { event: "move-ended" }, effect: { type: "ignore-modifiers" } });
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "move-ended" } });
  });

  it("gives the parenthetical's move-end rule the turn duration of the clause it belongs to", () => {
    const later = (mechanicsOf(text, pieces).effect.steps as Array<Record<string, any>>)[1]!;
    const parts = later.effect.steps as Array<Record<string, any>>;
    expect(parts.map((part) => part.duration)).toEqual(["turn", "turn"]);
    expect(JSON.stringify(parts[1])).toContain("no_end_in_engagement");
  });

  it("keeps one ability-wide duration when the later moment prints none", () => {
    const bare = text.replace("until the end of the turn, ", "");
    const mechanics = mechanicsOf(bare, pieces.filter((piece) => piece[0] !== "until the end of the turn"));
    expect(mechanics.scope.duration).toBe("phase");
  });});

describe("a Stratagem's RESTRICTIONS belong to its first part (compile.ts partOf)", () => {
  const text = "At the start of the phase.\nIf it is a KEYA unit, it has +1 OC. When this unit is set up, it has +2 OC.\nIf a KEYB unit is targeted with this Stratagem, it has -1 M.";
  const pieces: Piece[] = [
    ["At the start of the phase", "event", { kind: "phase-start", phase: "any" }, "WHEN"],
    ["If it is a KEYA unit", "unit-keyword", keyword("KEYA"), "EFFECT"],
    ["it has +1 OC", "characteristic-modifier", stat("OC", 1), "EFFECT"],
    ["When this unit is set up", "event", { kind: "set-up" }, "EFFECT"],
    ["it has +2 OC", "characteristic-modifier", stat("OC", 2), "EFFECT"],
    ["If a KEYB unit is targeted with this Stratagem", "unit-keyword", keyword("KEYB"), "RESTRICTIONS"],
    ["it has -1 M", "characteristic-modifier", { ...stat("M", 1), operation: "subtract" }, "RESTRICTIONS"],
  ];

  it("applies the restriction with the entry moment, not inside the later moment", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    expect(JSON.stringify(steps[0])).toContain('"operation":"subtract"');
    expect(JSON.stringify(steps[0])).toContain("KEYB");
    expect(JSON.stringify(steps[1])).not.toContain("KEYB");
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "set-up" } });
  });
});
