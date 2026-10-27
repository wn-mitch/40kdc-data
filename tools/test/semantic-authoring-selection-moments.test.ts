import { describe, expect, it } from "vitest";

import { bindAntecedents } from "../src/semantic-authoring/compile-antecedent.js";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
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

/** Every node of a compiled tree whose `type` is `type`, in order. */
function nodesOf(node: unknown, type: string): Record<string, any>[] {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodesOf(child, type));
  const record = node as Record<string, any>;
  return [...(record.type === type ? [record] : []), ...Object.values(record).flatMap((child) => nodesOf(child, type))];
}

const SHOOTING_OR_FIGHT = "In your Shooting phase and the Fight phase, add 1 to the Hit roll for this unit.";

describe("Semantic authoring phase windows joined by 'and' as alternatives", () => {
  it("folds two different phases into one either-phase condition, keeping the turn on the first", () => {
    const result = compileLeaves(placed(SHOOTING_OR_FIGHT,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["the Fight phase", "phase-window", { phase: "fight" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), SHOOTING_OR_FIGHT);
    expect(result.ok).toBe(true);
    const condition = (result.ok ? result.mechanics : {}) as Record<string, any>;
    expect(condition.effect.condition).toEqual({
      operator: "or",
      operands: [
        { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "shooting" } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] },
        { type: "phase-is", parameters: { phase: "fight" } },
      ],
    });
  });

  it("does not fold two windows of the same phase, which stay one conjunction", () => {
    const text = "In your Shooting phase and your Shooting phase, add 1 to the Hit roll for this unit.";
    const result = compileLeaves(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["your Shooting phase", "phase-window", { phase: "shooting" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).not.toContain('"operator":"or"');
  });
});

describe("Semantic authoring weapon-scoped change on an attached leader's own model", () => {
  const TEXT = "While this model is leading a unit, add 1 to the Attacks and Strength characteristics of Psychic weapons equipped by this model.";
  const ITEMS: Item[] = [
    ["While this model is leading a unit", "leading-unit", { attachment: "led", subject: "this-model" }],
    ["add 1 to the Attacks and Strength characteristics of Psychic weapons equipped by this model", "characteristic-modifier",
      { subject: "this-model", characteristics: ["A", "S"], operation: "add", value: 1, weapon_type: "all", weapon_keyword: "Psychic" }],
  ];

  it("keeps the bearer model as the target so the Psychic scope stays on its own weapons", () => {
    const result = compileLeaves(placed(TEXT, ...ITEMS), TEXT);
    expect(result.ok).toBe(true);
    const steps = nodesOf(result.ok ? result.mechanics : {}, "stat-modifier");
    expect(steps.map((step) => step.target)).toEqual(["this-model", "this-model"]);
    expect(steps.every((step) => step.modifier.weapons?.keyword?.keyword_id === "psychic")).toBe(true);
  });

  it("still widens a non-weapon change on the attached leader to its unit", () => {
    const text = "While this model is leading a unit, add 1 to the Wounds characteristic of this model.";
    const result = compileLeaves(placed(text,
      ["While this model is leading a unit", "leading-unit", { attachment: "led", subject: "this-model" }],
      ["add 1 to the Wounds characteristic of this model", "characteristic-modifier", { subject: "this-model", characteristics: ["W"], operation: "add", value: 1 }]), text);
    expect(result.ok).toBe(true);
    expect(nodesOf(result.ok ? result.mechanics : {}, "stat-modifier").map((step) => step.target)).toEqual(["this-unit"]);
  });
});

describe("Semantic authoring selection whose effect sits on a later moment", () => {
  const TEXT = "Each time a friendly Psyker model is destroyed, select one of those models with this ability. When that selected model attempts a Ritual, it has +1 to the test.";
  const SELECTION: Item[] = [
    ["Each time a friendly Psyker model is destroyed", "event", { kind: "model-destroyed" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["of those models", "unit-filter", { side: "friendly", keywords: ["PSYKER"], level: "model" }],
  ];
  const RITUAL: Item = ["When that selected model attempts a Ritual", "event", { kind: "used", activity: "ritual" }];
  const EFFECT: Item = ["it has +1 to the test", "roll-modifier", { roll: "psychic", operation: "add", value: 1, subject: "selected-unit" }];

  it("refuses a selected unit's effect that follows a later event instead of placing it at the selection", () => {
    const result = compileLeaves(placed(TEXT, ...SELECTION, RITUAL, EFFECT), TEXT);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("later moment");
  });

  it("does not refuse the selected unit's own attacks, which are the designation's duration", () => {
    const text = "At the start of the Fight phase, select one enemy unit. Until the end of the phase, each time a model in that unit makes an attack, subtract 1 from the Hit roll.";
    const result = compileLeaves(placed(text,
      ["At the start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["each time a model in that unit makes an attack", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }],
      ["subtract 1 from the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1, subject: "selected-unit" }]), text);
    expect(result.ok ? "" : result.errors.join(" ")).not.toContain("later moment");
  });

  it("compiles the same selection when its effect follows no later event", () => {
    const text = "When a friendly Psyker model is destroyed, select one of those models. It has +1 to the test.";
    const result = compileLeaves(placed(text,
      ["When a friendly Psyker model is destroyed", "event", { kind: "model-destroyed" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["of those models", "unit-filter", { side: "friendly", keywords: ["PSYKER"], level: "model" }],
      ["It has +1 to the test", "roll-modifier", { roll: "psychic", operation: "add", value: 1, subject: "selected-unit" }]), text);
    expect(result.ok).toBe(true);
  });
});

describe("Semantic authoring antecedent 'of' after an attack the record makes", () => {
  const TEXT = "Once per turn, when an enemy unit makes a ranged attack that targets a friendly NECRONS unit within 3\" of a model with this ability, select one model with this ability that is within 3\" of that target can shoot.";
  const LEAVES = (): CompileLeaf[] => placed(TEXT,
    ["Once per turn", "usage-scope", { per: "unit" }],
    ["when an enemy unit makes a ranged attack", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "ranged" }],
    ["friendly NECRONS unit", "unit-filter", { side: "friendly", keywords: ["NECRONS"] }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["within 3\" of that target", "unit-position", { kind: "within", inches: 3, of: "antecedent", subject: "selected-unit", negated: false }],
    ["can shoot", "eligibility-permission", { subject: "antecedent", activity: "shoot", allow: true, as_if: "shooting-phase" }]);

  it("binds the 'of' of that target to the attacked unit, and the permission's subject to the selection", () => {
    const bound = bindAntecedents(LEAVES());
    expect(bound.find((leaf) => leaf.family_id === "unit-position")?.parameters.of).toBe("target");
    expect(bound.find((leaf) => leaf.family_id === "eligibility-permission")?.parameters.subject).toBe("selected-unit");
  });

  it("leaves 'of' bound to the selection when no attack precedes it", () => {
    const leaves = LEAVES().filter((leaf) => leaf.family_id !== "attack");
    const position = bindAntecedents(leaves).find((leaf) => leaf.family_id === "unit-position");
    expect(position?.parameters.of).toBe("selected-unit");
  });
});

describe("Semantic authoring selection shapes of the model-selection rows", () => {
  it("binds a model-level membership to the ability's own unit", () => {
    const text = "Each time that unit is selected, select one Bodyguard model in that unit; that model is destroyed.";
    const result = compileLeaves(placed(text,
      ["Each time that unit is selected", "event", { kind: "selected", to: "shoot", subject: "this-unit" }],
      ["select one", "select-unit", { distance: "any", visible: false, bind_as: "bodyguard" }],
      ["Bodyguard model", "unit-filter", { side: "friendly", any_keywords: ["BODYGUARD"], level: "model" }],
      ["in that unit", "membership", { relation: "in", of: "this-unit" }],
      ["that model is destroyed", "destroy-models", { recipient: "selected-unit" }]), text);
    expect(result.ok).toBe(true);
    const selector = nodesOf(result.ok ? result.mechanics : {}, "select-units")[0]!.selector;
    expect(selector.filter).toEqual({ owner: "friendly", any_of: ["BODYGUARD"], level: "model", member_of: "this-unit" });
  });

  it("binds an enemy selection within range of and visible to the first selection's model", () => {
    const text = "In your Shooting phase, select one friendly EXPLOSIVES model in your unit. Select one unengaged enemy unit within 8\" of and visible to that model. The selected unit suffers 1 mortal wound.";
    const result = compileLeaves(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "shooter" }],
      ["EXPLOSIVES model", "unit-filter", { side: "friendly", any_keywords: ["EXPLOSIVES"], level: "model" }],
      ["Select one unengaged", "select-unit", { distance: "within", inches: 8, visible: true, within_of: "shooter", visible_to: "shooter" }],
      ["enemy unit", "unit-filter", { side: "enemy", states: ["unengaged"] }],
      ["suffers 1 mortal wound", "mortal-wounds", { amount: 1, recipient: "selected-unit" }]), text);
    expect(result.ok).toBe(true);
    const enemy = nodesOf(result.ok ? result.mechanics : {}, "select-units").find((node) => node.selector.filter.owner === "enemy")!.selector;
    expect(enemy).toMatchObject({
      filter: { within: { range: { inches: 8 }, of: { selection_var: "shooter" } }, owner: "enemy" },
    });
    expect(enemy.filter.visible).toEqual({ to: { selection_var: "shooter" } });
  });

  it("refuses the enemy selection when the first selection has no bind_as to measure from", () => {
    const text = "In your Shooting phase, select one friendly EXPLOSIVES model in your unit. Select one unengaged enemy unit within 8\" of and visible to that model. The selected unit suffers 1 mortal wound.";
    const result = compileLeaves(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["select one friendly", "select-unit", { distance: "any", visible: false }],
      ["EXPLOSIVES model", "unit-filter", { side: "friendly", any_keywords: ["EXPLOSIVES"], level: "model" }],
      ["Select one unengaged", "select-unit", { distance: "within", inches: 8, visible: true, within_of: "shooter", visible_to: "shooter" }],
      ["enemy unit", "unit-filter", { side: "enemy", states: ["unengaged"] }],
      ["suffers 1 mortal wound", "mortal-wounds", { amount: 1, recipient: "selected-unit" }]), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("\n")).toContain("bound by a name (bind_as)");
  });

  it("compiles a model selection by its own ability as selector structure only, bound to the record id", () => {
    const text = "When a friendly Psyker model is destroyed, select one of those models with this ability within 9\" of it. It has +1 to the test.";
    const result = compileLeaves(placed(text,
      ["When a friendly Psyker model is destroyed", "event", { kind: "model-destroyed" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["of those models", "unit-filter", { side: "friendly", level: "model" }],
      ["with this ability", "unit-has-ability", { subject: "selected-unit", own: true, negated: false }],
      ["within 9\" of it", "unit-position", { kind: "within", inches: 9, of: "event-object", subject: "selected-unit", negated: false }],
      ["It has +1 to the test", "roll-modifier", { roll: "psychic", operation: "add", value: 1, subject: "selected-unit" }]), text,
    { abilityId: "spirit-snare-zadophon-the-soul-eater-thousand-sons" });
    expect(result.ok).toBe(true);
    const selector = nodesOf(result.ok ? result.mechanics : {}, "select-units")[0]!.selector;
    expect(selector.eligibility.operands).toEqual(expect.arrayContaining([
      { type: "matches", parameters: { subject: "selected-unit", filter: { within: { of: "event-object", range: { inches: 9 } } } } },
      { type: "matches", parameters: { subject: "selected-unit", filter: { has_ability: ["spirit-snare-zadophon-the-soul-eater-thousand-sons"] } } },
    ]));
  });
});

describe("Semantic authoring 9016 full leaf set under the record's own events", () => {
  // Fabricated wording with the record's leaf structure: a once-per-turn attack trigger, a selected
  // model, a permission on it, and the record's targeting restriction and eligibility leaves.
  const TEXT = "Once per turn, in your opponent's Shooting phase, when a foe unit makes a ranged attack that targets a friendly GAUNTS unit within 3\" of a model with this ability, after that foe unit has shot, select one model with this ability that is within 3\" of that target can shoot as if it were your Shooting phase, but it must target only that foe unit when doing so, and can only do so if that foe unit is an eligible target.";
  const OPTIONS = { abilityId: "fabricated-snap-fire-fabricated-faction" };
  const FULL = (): CompileLeaf[] => placed(TEXT,
    ["Once", "usage-limit", { frequency: "once-per-turn" }],
    ["per turn", "usage-scope", { per: "unit" }],
    ["in your opponent's Shooting phase", "phase-window", { phase: "shooting", turn: "opponent" }],
    ["when a foe unit makes a ranged attack", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "ranged" }],
    ["friendly GAUNTS unit", "unit-filter", { side: "friendly", keywords: ["GAUNTS"] }],
    ["after that foe unit has shot", "event", { kind: "enemy-has-shot" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["model", "unit-filter", { side: "friendly", level: "model" }],
    ["with this ability that", "unit-has-ability", { subject: "selected-unit", own: true, negated: false }],
    ["within 3\" of that target", "unit-position", { kind: "within", inches: 3, of: "antecedent", subject: "selected-unit", negated: false }],
    ["can shoot", "eligibility-permission", { subject: "antecedent", activity: "shoot", allow: true, as_if: "shooting-phase" }],
    ["must target only that foe unit", "targeting-restriction", { may: "must-target", kind: "shoot", weapon_type: "all", target: "event-subject", by: "this-model" }],
    ["an eligible target", "eligible", { to: "shoot" }]);

  it("binds the permission's subject and the 'of' after the attack to the selection and the attacked unit", () => {
    const bound = bindAntecedents(FULL());
    expect(bound.find((leaf) => leaf.family_id === "eligibility-permission")?.parameters.subject).toBe("selected-unit");
    expect(bound.find((leaf) => leaf.family_id === "unit-position")?.parameters.of).toBe("target");
  });

  it("keeps the selected-model attack refusal", () => {
    const result = compileLeaves(FULL(), TEXT, OPTIONS);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([expect.stringContaining("An attack made by a selected model has no decided binding yet")]);
  });

  it("targets the permission at the selected unit once the attack leaf is out of the way", () => {
    const result = compileLeaves(FULL().filter((leaf) => leaf.family_id !== "attack"), TEXT, OPTIONS);
    expect(result.ok).toBe(true);
    const mechanics = result.ok ? JSON.stringify(result.mechanics) : "";
    expect(mechanics).toContain('"type":"permission","target":"selected-unit"');
    expect(mechanics).toContain('"usage":{"frequency":"once-per-turn","per":"unit"}');
  });

  it("clears the usage refusal with a usage scope and keeps the other refusals", () => {
    const withoutScope = compileLeaves(FULL().filter((leaf) => leaf.family_id !== "usage-scope"), TEXT, OPTIONS);
    expect(withoutScope.ok ? [] : withoutScope.errors.join("\n")).toContain("Usage frequency needs a reviewed usage scope");
    const withScope = compileLeaves(FULL(), TEXT, OPTIONS);
    expect(withScope.ok ? [] : withScope.errors.join("\n")).not.toContain("Usage frequency");
  });
});

describe("Semantic authoring antecedent binding bookkeeping", () => {
  it("keeps the bound keys off the leaf's parameters, so no output or fingerprint can read them", () => {
    const text = "Once per turn, when a foe unit makes a ranged attack that targets a friendly GAUNTS unit, select one model with this ability that is within 3\" of that target can shoot.";
    const bound = bindAntecedents(placed(text,
      ["Once", "usage-limit", { frequency: "once-per-turn" }],
      ["when a foe unit makes a ranged attack", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "ranged" }],
      ["friendly GAUNTS unit", "unit-filter", { side: "friendly", keywords: ["GAUNTS"] }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["within 3\" of that target", "unit-position", { kind: "within", inches: 3, of: "antecedent", subject: "selected-unit", negated: false }]));
    const position = bound.find((leaf) => leaf.family_id === "unit-position")!;
    expect(position.parameters).not.toHaveProperty("antecedent_keys");
    expect(position.antecedent_keys).toEqual(expect.arrayContaining(["of"]));
  });
});

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-objective-body" });

const OPEN: Item = ["Select one objective marker", "select-objective-open", { bind_as: "marker" }];
const IN_RANGE: Item = ["While this model is within range of that objective", "unit-position", { kind: "objective-range", objective: "selected", subject: "this-model", negated: false }];
const FIRST: Item = ["this model has Fights First", "fights-first", { subject: "this-model" }];
const PAIN: Item = ["It also has Feel No Pain 5+", "feel-no-pain", { subject: "this-model", threshold: 5, against: "all" }];
const TEXT = "Select one objective marker. While this model is within range of that objective, this model has Fights First. It also has Feel No Pain 5+.";

function refusal(text: string, ...items: Item[]): string {
  const result = run(text, ...items);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join(" ");
}

describe("Semantic authoring select-objective: every sentence after the opener is its body", () => {
  it("folds a condition and two effect sentences into one conditional over a sequence", () => {
    const result = run(TEXT, OPEN, IN_RANGE, FIRST, PAIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const effect = result.mechanics.effect as Record<string, any>;
    expect(effect.type).toBe("select-objective");
    expect(effect.effect.type).toBe("conditional");
    expect(effect.effect.effect.type).toBe("sequence");
    expect(effect.effect.effect.steps).toHaveLength(2);
  });

  it("still compiles a single sentence after the opener, as before", () => {
    const text = "Select one objective marker. While this model is within range of that objective, this model has Fights First.";
    const result = run(text, OPEN, IN_RANGE, FIRST);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.mechanics.effect as Record<string, any>).effect.type).toBe("conditional");
  });

  it("refuses an opener with no sentence after it", () => {
    expect(refusal("Select one objective marker.", OPEN)).toMatch(/needs exactly one sentence after it/u);
  });

  it("keeps refusing two sentences after a persistent designation", () => {
    const text = "Select one enemy unit to be this model's quarry. This model has Fights First. It also has Feel No Pain 5+.";
    const designation: Item = ["to be this model's quarry", "persistent-designation-open", { designation: "prey", scope: "enemy-unit", timing: "start-of-first-battle-round", beneficiary: "this-model" }];
    expect(refusal(text, designation, ["This model has Fights First", "fights-first", { subject: "this-model" }], PAIN)).toMatch(/needs exactly one sentence after it/u);
  });

  it("does not fold a later sentence that opens a moment, into the conditional body", () => {
    const text = `${TEXT} Each time this model fights, it has Fights First.`;
    const result = run(text, OPEN, IN_RANGE, FIRST, PAIN, ["Each time this model fights", "event", { kind: "attacks-resolved", subject: "this-model" }], ["it has Fights First", "fights-first", { subject: "this-model" }]);
    // The moment's sentence is its own part of the ability (a sibling), never a third step of the objective's body.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const steps = (result.mechanics.effect as Record<string, any>).steps as Array<Record<string, any>>;
    expect(steps[0]!.effect.effect.steps).toHaveLength(2);
    expect(steps[1]!.type).toBe("ability-part");
  });

  it("refuses rather than folds a later sentence with a usage limit, a phase or a duration", () => {
    const withLater = (sentence: string, ...later: Item[]) => refusal(`${TEXT} ${sentence}`, OPEN, IN_RANGE, FIRST, PAIN, ...later);
    expect(withLater("Once per turn, this model has Fights First.", ["Once", "usage-limit", { frequency: "once-per-turn" }], ["per turn", "usage-scope", { per: "model" }], ["this model has Fights First", "fights-first", { subject: "this-model" }]))
      .toMatch(/needs exactly one sentence after it/u);
    expect(withLater("In the Fight phase, this model has Fights First.", ["In the Fight phase", "phase-window", { phase: "fight", turn: "either" }], ["this model has Fights First", "fights-first", { subject: "this-model" }]))
      .toMatch(/needs exactly one sentence after it/u);
    expect(withLater("Until the end of the turn, this model has Fights First.", ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }], ["this model has Fights First", "fights-first", { subject: "this-model" }]))
      .toMatch(/needs exactly one sentence after it/u);
  });
});
