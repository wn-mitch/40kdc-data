import { describe, expect, it } from "vitest";

import { keywordsIn, predicateProposal } from "../src/round5c/leaf-predicate-rules.js";

// Fabricated keywords and wording only.
const index = new Map(["Monster", "Vehicle", "Fly", "Character", "Stellar Wardens", "Wardens"].map((keyword) => [keyword.toUpperCase(), keyword]));

describe("Round 5C predicate proposals from the wording", () => {
  it("finds core keywords whatever their case, preferring the longest", () => {
    expect(keywordsIn("that targets a Monster or **VEHICLE** unit", index)).toEqual(["MONSTER", "VEHICLE"]);
    expect(keywordsIn("that targets a STELLAR WARDENS unit", index)).toEqual(["STELLAR WARDENS"]);
  });

  it("proposes the keyword a targeted unit must have, negated where the words say not", () => {
    expect(predicateProposal("that targets a Monster or Vehicle unit", index)).toMatchObject({
      family_id: "unit-keyword", parameters: { keywords: ["MONSTER", "VEHICLE"], subject: "target", negated: false },
    });
    expect(predicateProposal("that target is a **MONSTER** or **VEHICLE** unit", index)).toMatchObject({ family_id: "unit-keyword", parameters: { keywords: ["MONSTER", "VEHICLE"] } });
    expect(predicateProposal("that targets a unit that cannot FLY", index)).toMatchObject({
      family_id: "unit-keyword", parameters: { keywords: ["FLY"], subject: "target", negated: true },
    });
  });

  it("proposes states and marks, including this model on the battlefield", () => {
    expect(predicateProposal("If this model is on the battlefield", index)).toMatchObject({
      family_id: "unit-state", family_version: 4, parameters: { states: ["on-battlefield"], subject: "this-model", negated: false },
    });
    expect(predicateProposal("that targets a unit that is not Below Half-strength", index)).toMatchObject({
      family_id: "unit-state", parameters: { states: ["below-half-strength"], subject: "target", negated: true },
    });
    expect(predicateProposal("that targets a Spotted unit", index)).toMatchObject({ family_id: "unit-mark", parameters: { mark: "spotted", subject: "target" } });
  });

  it("proposes nothing for capitals that are not unit keywords, for effects, or for long composed wording", () => {
    expect(predicateProposal("that targets a GIZMO unit", index)).toBeNull();
    expect(predicateProposal("that targets an enemy unit", index)).toBeNull();
    expect(predicateProposal("add 1 to the Hit roll", index)).toBeNull();
    expect(predicateProposal("that targets a MONSTER unit, add 1 to the Hit roll and re-roll the Wound roll for every attack this unit makes", index)).toBeNull();
    // Two families fully stated at once is composed wording, not one leaf.
    expect(predicateProposal("that targets a MONSTER unit that is Battle-shocked", index)).toBeNull();
    // Words the leaf cannot hold (a model count, attachment, an event, an effect) mean it is not this leaf.
    expect(predicateProposal("that targets a Monster unit containing 5 or more models", index)).toBeNull();
    expect(predicateProposal("While a CHARACTER model is leading this unit", index)).toBeNull();
    expect(predicateProposal("when an enemy unit targets a friendly MONSTER unit", index)).toBeNull();
    expect(predicateProposal("that target a MONSTER/VEHICLE unit can re-roll wound rolls", index)).toBeNull();
    expect(predicateProposal("that targets the closest eligible target within 18", index)).toBeNull();
    expect(predicateProposal("that targets an enemy unit that is more than 12\" away", index)).toMatchObject({ family_id: "unit-position", parameters: { kind: "beyond", inches: 12 } });
  });
});
