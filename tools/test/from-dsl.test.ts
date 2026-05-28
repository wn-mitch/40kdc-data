import { describe, expect, it } from "vitest";
import { effectToBuffs, parseKeywordGrant } from "../src/cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "../src/cruncher/buffs.js";

const armyRule: BuffSource = {
  kind: "ability",
  abilityId: "oath-of-moment",
  abilityKind: "army",
};
const unitRule: BuffSource = {
  kind: "ability",
  abilityId: "fury",
  abilityKind: "unit",
};
const ctx: EngineContext = { phase: "shooting", attackerStationary: false };

describe("effectToBuffs: leaves", () => {
  it("re-roll → reroll buff", () => {
    const result = effectToBuffs(
      {
        type: "re-roll",
        target: "unit",
        modifier: { roll: "hit", subset: "all-failures" },
      },
      armyRule,
      ctx,
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].contribution).toEqual({
      type: "reroll",
      roll: "hit",
      subset: "all-failures",
    });
    expect(result.unsupported).toEqual([]);
  });

  it("roll-modifier add → matching mod buff", () => {
    const result = effectToBuffs(
      {
        type: "roll-modifier",
        target: "unit",
        modifier: { roll: "wound", operation: "add", value: 1 },
      },
      unitRule,
      ctx,
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].contribution).toEqual({ type: "wound-mod", value: 1 });
  });

  it("roll-modifier subtract → negative buff", () => {
    const result = effectToBuffs(
      {
        type: "roll-modifier",
        target: "unit",
        modifier: { roll: "hit", operation: "subtract", value: 1 },
      },
      unitRule,
      ctx,
    );
    expect(result.applied[0].contribution).toEqual({ type: "hit-mod", value: -1 });
  });

  it("stat-modifier S → strength-mod", () => {
    const result = effectToBuffs(
      {
        type: "stat-modifier",
        target: "unit",
        modifier: { stat: "S", operation: "add", value: 1 },
      },
      unitRule,
      ctx,
    );
    expect(result.applied[0].contribution).toEqual({ type: "strength-mod", value: 1 });
  });

  it("stat-modifier A → attacks-mod", () => {
    const result = effectToBuffs(
      {
        type: "stat-modifier",
        target: "unit",
        modifier: { stat: "A", operation: "add", value: 1 },
      },
      unitRule,
      ctx,
    );
    expect(result.applied[0].contribution).toEqual({ type: "attacks-mod", value: 1 });
  });

  it("feel-no-pain → FNP buff under target perspective", () => {
    const result = effectToBuffs(
      { type: "feel-no-pain", target: "unit", modifier: { threshold: 5 } },
      unitRule,
      ctx,
      "target",
    );
    expect(result.applied[0].contribution).toEqual({ type: "feel-no-pain", threshold: 5 });
  });

  it("feel-no-pain drops silently under attacker perspective", () => {
    const result = effectToBuffs(
      { type: "feel-no-pain", target: "unit", modifier: { threshold: 5 } },
      unitRule,
      ctx,
    );
    expect(result.applied).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  it("keyword-grant 'Sustained Hits 1' → extra-keyword buff", () => {
    const result = effectToBuffs(
      {
        type: "keyword-grant",
        target: "unit",
        modifier: { keywords: ["Sustained Hits 1"] },
      },
      unitRule,
      ctx,
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].contribution).toEqual({
      type: "extra-keyword",
      keywordRef: { keyword_id: "sustained-hits", parameters: { value: 1 } },
    });
  });
});

describe("effectToBuffs: compound", () => {
  it("sequence walks every step", () => {
    const oath = {
      type: "sequence",
      steps: [
        {
          type: "re-roll",
          target: "unit",
          modifier: { roll: "hit", subset: "all-failures" },
        },
        {
          type: "re-roll",
          target: "unit",
          modifier: { roll: "wound", subset: "all-failures" },
        },
      ],
    };
    const result = effectToBuffs(oath, armyRule, ctx);
    expect(result.applied).toHaveLength(2);
    expect(result.applied[0].contribution).toMatchObject({ roll: "hit" });
    expect(result.applied[1].contribution).toMatchObject({ roll: "wound" });
  });

  it("conditional gated by phase: fires only in matching phase", () => {
    const effect = {
      type: "conditional",
      condition: { type: "phase-is", parameters: { phase: "fight" } },
      effect: {
        type: "roll-modifier",
        target: "unit",
        modifier: { roll: "wound", operation: "add", value: 1 },
      },
    };
    const shooting = effectToBuffs(effect, unitRule, { phase: "shooting" });
    expect(shooting.applied).toEqual([]);
    const fight = effectToBuffs(effect, unitRule, { phase: "fight" });
    expect(fight.applied[0].contribution).toEqual({ type: "wound-mod", value: 1 });
  });

  it("choice fragments are routed to unsupported", () => {
    const result = effectToBuffs(
      {
        type: "choice",
        options: [
          { type: "re-roll", target: "unit", modifier: { roll: "hit", subset: "ones" } },
          { type: "re-roll", target: "unit", modifier: { roll: "wound", subset: "ones" } },
        ],
      },
      unitRule,
      ctx,
    );
    expect(result.applied).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0].reason).toMatch(/choice/);
  });

  it("dice-gated fragments are routed to unsupported", () => {
    const result = effectToBuffs(
      {
        type: "dice-gated",
        dice: "D6",
        threshold: 6,
        on_success: { type: "mortal-wounds", target: "defender", modifier: { count: "1" } },
      },
      unitRule,
      ctx,
    );
    expect(result.applied).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
  });

  it("conditional whose condition the engine can't evaluate is unsupported", () => {
    const result = effectToBuffs(
      {
        type: "conditional",
        condition: { type: "is-attached" },
        effect: {
          type: "roll-modifier",
          target: "unit",
          modifier: { roll: "wound", operation: "add", value: 1 },
        },
      },
      unitRule,
      ctx,
    );
    expect(result.applied).toEqual([]);
    expect(result.unsupported[0].reason).toMatch(/cannot evaluate condition/);
  });
});

describe("effectToBuffs: target filtering", () => {
  it("defender-side rolls are dropped without going to unsupported", () => {
    // A roll-modifier targeting "defender" describes "+1 to opponent's wound
    // rolls against me" — irrelevant when *I* am the attacker.
    const result = effectToBuffs(
      {
        type: "roll-modifier",
        target: "defender",
        modifier: { roll: "wound", operation: "subtract", value: 1 },
      },
      unitRule,
      ctx,
    );
    expect(result.applied).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  it("attacker-perspective targets are accepted", () => {
    for (const target of ["self", "bearer", "unit", "attacker", "attached-unit", "friendly-within-aura"]) {
      const result = effectToBuffs(
        {
          type: "roll-modifier",
          target,
          modifier: { roll: "hit", operation: "add", value: 1 },
        },
        unitRule,
        ctx,
      );
      expect(result.applied, `target ${target}`).toHaveLength(1);
    }
  });
});

describe("oath-of-moment full effect", () => {
  it("produces hit + wound rerolls and no diagnostics", () => {
    const oath = {
      type: "sequence",
      steps: [
        {
          type: "re-roll",
          target: "unit",
          modifier: { roll: "hit", subset: "all-failures" },
        },
        {
          type: "re-roll",
          target: "unit",
          modifier: { roll: "wound", subset: "all-failures" },
        },
      ],
    };
    const result = effectToBuffs(oath, armyRule, ctx);
    expect(result.unsupported).toEqual([]);
    expect(result.applied.map((b) => b.contribution)).toEqual([
      { type: "reroll", roll: "hit", subset: "all-failures" },
      { type: "reroll", roll: "wound", subset: "all-failures" },
    ]);
  });
});

describe("effectToBuffs: target perspective", () => {
  const ctxT: EngineContext = { phase: "shooting" };

  it("stat-modifier T translates to toughness-mod", () => {
    const result = effectToBuffs(
      {
        type: "stat-modifier",
        target: "unit",
        modifier: { stat: "T", operation: "add", value: 1 },
      },
      unitRule,
      ctxT,
      "target",
    );
    expect(result.applied[0].contribution).toEqual({ type: "toughness-mod", value: 1 });
  });

  it("stat-modifier Sv translates to save-mod with sign inversion", () => {
    // "+1 Sv" improves the save → makes the needed roll *lower* → save-mod -1.
    const improve = effectToBuffs(
      {
        type: "stat-modifier",
        target: "unit",
        modifier: { stat: "Sv", operation: "add", value: 1 },
      },
      unitRule,
      ctxT,
      "target",
    );
    expect(improve.applied[0].contribution).toEqual({ type: "save-mod", value: -1 });

    // "-1 Sv" worsens the save → needed roll goes up → save-mod +1.
    const worsen = effectToBuffs(
      {
        type: "stat-modifier",
        target: "unit",
        modifier: { stat: "Sv", operation: "subtract", value: 1 },
      },
      unitRule,
      ctxT,
      "target",
    );
    expect(worsen.applied[0].contribution).toEqual({ type: "save-mod", value: 1 });
  });

  it("roll-modifier save translates under target perspective only", () => {
    const node = {
      type: "roll-modifier",
      target: "unit",
      modifier: { roll: "save", operation: "add", value: 1 },
    };
    const tgt = effectToBuffs(node, unitRule, ctxT, "target");
    expect(tgt.applied[0].contribution).toEqual({ type: "save-mod", value: 1 });
    const atk = effectToBuffs(node, unitRule, ctxT, "attacker");
    expect(atk.applied).toEqual([]); // saves aren't attacker-side.
  });

  it("bs-modifier on target: attacker translates to hit-mod under target perspective", () => {
    const result = effectToBuffs(
      {
        type: "bs-modifier",
        target: "attacker",
        modifier: { operation: "subtract", value: 1 },
      },
      unitRule,
      ctxT,
      "target",
    );
    expect(result.applied[0].contribution).toEqual({ type: "hit-mod", value: -1 });
  });

  it("attacker-side rerolls are dropped under target perspective", () => {
    const result = effectToBuffs(
      {
        type: "re-roll",
        target: "unit",
        modifier: { roll: "hit", subset: "all-failures" },
      },
      armyRule,
      ctxT,
      "target",
    );
    expect(result.applied).toEqual([]);
  });

  it("save reroll under target perspective passes through", () => {
    const result = effectToBuffs(
      {
        type: "re-roll",
        target: "unit",
        modifier: { roll: "save", subset: "ones" },
      },
      unitRule,
      ctxT,
      "target",
    );
    expect(result.applied[0].contribution).toEqual({
      type: "reroll",
      roll: "save",
      subset: "ones",
    });
  });

  it("keyword-grant is attacker-side, drops under target perspective", () => {
    const result = effectToBuffs(
      {
        type: "keyword-grant",
        target: "unit",
        modifier: { keywords: ["Lethal Hits"] },
      },
      unitRule,
      ctxT,
      "target",
    );
    expect(result.applied).toEqual([]);
  });
});

describe("parseKeywordGrant", () => {
  it.each([
    ["Lethal Hits", { keyword_id: "lethal-hits" }],
    ["Sustained Hits 1", { keyword_id: "sustained-hits", parameters: { value: 1 } }],
    ["Sustained Hits 2", { keyword_id: "sustained-hits", parameters: { value: 2 } }],
    ["Twin-linked", { keyword_id: "twin-linked" }],
    ["Precision", { keyword_id: "precision" }],
    ["Rapid Fire 1", { keyword_id: "rapid-fire", parameters: { value: 1 } }],
    [
      "Anti-INFANTRY 4+",
      { keyword_id: "anti", parameters: { target_keyword: "INFANTRY", threshold: 4 } },
    ],
  ])("%s → %j", (input, expected) => {
    expect(parseKeywordGrant(input)).toEqual(expected);
  });
});
