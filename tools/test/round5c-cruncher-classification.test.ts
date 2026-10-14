import { describe, expect, it } from "vitest";

import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "../src/cruncher/buffs.js";
import { classifyUnsupported } from "../src/round5c/pipeline-8b.js";

// Fabricated wording only; no GW rule prose.

/**
 * Pins pipeline-8b's three-way classification of `effectToBuffs`'s `unsupported` output:
 * honest runtime unknown (live game state the static cruncher can't resolve), outside the damage
 * path by design (the cruncher estimates damage; healing and non-combat stats/rolls are out of
 * its scope on purpose, not gaps), and unrecognized shape (a real gap: a damage-path effect the
 * cruncher should be able to model but can't parse).
 */

const source: BuffSource = { kind: "ability", abilityId: "fixture", abilityKind: "unit" };
const ctx: EngineContext = { phase: "shooting", attackerStationary: false };

describe("pipeline-8b cruncher unsupported classification", () => {
  it("counts a heal effect as outside the damage path, not an unrecognized shape", () => {
    const { unsupported } = effectToBuffs({ type: "heal", target: "this-unit", modifier: { value: 3 } }, source, ctx);
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
  });

  it("counts an eligibility permission as outside the damage path, but keeps an unmodelled core-ability grant a real gap", () => {
    const permission = effectToBuffs({ type: "permission", target: "this-unit", modifier: { activity: "shoot", allow: true } }, source, ctx).unsupported;
    const grant = effectToBuffs({ type: "ability-grant", target: "this-unit", modifier: { ability: "stealth" } }, source, ctx).unsupported;
    expect(classifyUnsupported(permission)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
    expect(classifyUnsupported(grant)).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 });
  });

  it("counts a Wounds stat-modifier as outside the damage path (A/S/T/Sv are the damage-path stats)", () => {
    const { unsupported } = effectToBuffs({ type: "stat-modifier", target: "this-unit", modifier: { stat: "W", operation: "add", value: 1 } }, source, ctx);
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
  });

  it("counts a re-roll of a non-combat roll (charge) as outside the damage path", () => {
    const { unsupported } = effectToBuffs({ type: "re-roll", target: "this-unit", modifier: { roll: "charge", subset: "all" } }, source, ctx);
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 1, unrecognizedShape: 0 });
  });

  it("keeps a damage-path re-roll with an unparseable subset as an unrecognized shape, not outside the damage path", () => {
    // Same "... is outside the damage path" wording as the charge case above, but this one is a
    // real gap: "hit" IS a damage-path roll, the subset value is just something the cruncher
    // can't parse — the two must not collapse into the same bucket just because of the message.
    const { unsupported } = effectToBuffs({ type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "bogus" } }, source, ctx);
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 0, outsideDamagePath: 0, unrecognizedShape: 1 });
  });

  it("still counts an honest runtime unknown as its own bucket, not outside the damage path", () => {
    const { unsupported } = effectToBuffs(
      { type: "conditional", condition: { type: "designated", parameters: { subject: "defender", tag: "X" } }, effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } } },
      source, ctx,
    );
    expect(classifyUnsupported(unsupported)).toEqual({ honestUnknown: 1, outsideDamagePath: 0, unrecognizedShape: 0 });
  });
});
