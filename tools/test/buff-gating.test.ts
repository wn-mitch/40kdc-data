import { describe, expect, it } from "vitest";

import { Dataset, emptyRawData } from "../src/data/index.js";

// Fabricated abilities: the same five are pinned in the Python and Go data-model tests.
const reroll = { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } };
function dataset() {
  const raw = emptyRawData();
  raw.units = [{
    id: "fixture-unit",
    name: "Fixture Unit",
    faction_id: "orks",
    keywords: ["Infantry"],
    faction_keywords: ["Orks"],
    profiles: [{ name: "Fixture", M: 6, T: 4, W: 1, Sv: 5, Ld: 7, OC: 1 }],
    model_count: { min: 1, max: 1 },
  }] as never;
  raw.detachments = [{
    id: "fixture-detachment",
    name: "Fixture Detachment",
    faction_id: "orks",
    stratagem_ids: ["fixture-stratagem-card"],
  }] as never;
  raw.stratagems = [{
    id: "fixture-stratagem-card",
    name: "Fixture Stratagem Card",
    category: "detachment",
    detachment_id: "fixture-detachment",
    cp_cost: 1,
    phases: ["fight"],
    ability_id: "fixture-stratagem",
  }] as never;
  raw.abilities = [
    { ability_id: "fixture-usage", name: "Fixture Usage", faction_id: "orks", behavior: "passive", usage: { frequency: "n-per-battle", count: 1 }, effect: reroll },
    { ability_id: "fixture-stratagem", name: "Fixture Stratagem", faction_id: "orks", ability_type: "stratagem", behavior: "activated", usage: { frequency: "once-per-turn" }, effect: reroll },
    { ability_id: "fixture-moment", name: "Fixture Moment", faction_id: "orks", behavior: "reactive", trigger: { event: "selected", filter: { to: "shoot" } }, usage: { frequency: "once-per-turn" }, effect: reroll },
    { ability_id: "fixture-attack-step", name: "Fixture Attack Step", faction_id: "orks", behavior: "reactive", trigger: { event: "before-roll", subject: { owner: "any" }, filter: { roll: "hit" } }, effect: reroll },
    { ability_id: "fixture-charge", name: "Fixture Charge", faction_id: "orks", behavior: "reactive", trigger: { event: "move-ended", filter: { move_types: ["charge"] } }, effect: reroll },
    {
      ability_id: "fixture-command-part",
      name: "Fixture Command Part",
      faction_id: "orks",
      behavior: "passive",
      scope: { duration: "battle-round" },
      effect: {
        type: "ability-part",
        trigger: { event: "phase-started", condition: { type: "phase-is", parameters: { phase: "command" } } },
        effect: reroll,
      },
    },
    {
      ability_id: "fixture-phase-effect",
      name: "Fixture Phase Effect",
      faction_id: "orks",
      behavior: "passive",
      effect: {
        type: "conditional",
        condition: { type: "phase-is", parameters: { phase: "fight" } },
        effect: reroll,
      },
    },
  ] as never;
  return new Dataset(raw);
}
const buffs = (id: string, context: Record<string, unknown> = { phase: "fight" }) => {
  const ability = dataset().abilities.getInFaction(id, "orks")!;
  const result = ability.describeBuffs({ kind: "ability", abilityId: id, abilityKind: "unit" } as never, context as never);
  return {
    applied: result.applied.length,
    levers: result.activatable.map((lever) => ({
      buffs: lever.buffs.length,
      group: lever.group,
      requires: lever.requires,
    })),
  };
};

describe("ability-level gating of buffs", () => {
  it("makes a usage-limited buff opt-in and carries its usage requirement and pool", () => {
    const result = buffs("fixture-usage");
    expect(result.applied).toBe(0);
    expect(result.levers).toHaveLength(1);
    expect(result.levers[0]).toMatchObject({
      buffs: 1,
      group: { id: "fixture-usage?usage", maxActivations: 1 },
      requires: [{ usage: { frequency: "n-per-battle", count: 1 } }],
    });
  });

  it("does not autoapply a Stratagem buff", () => {
    const ds = dataset();
    const input = { unitId: "fixture-unit", factionId: "orks", detachmentId: "fixture-detachment" };
    expect(ds.buffsFor(input, { phase: "fight" })).toEqual([]);
    expect(ds.stackableBuffsFor(input, { phase: "fight" }).buffs).toContainEqual(
      expect.objectContaining({
        id: "detachment-stratagem:fixture-stratagem",
        enabled: false,
        cost: { cp: 1 },
      }),
    );
  });
  it("keeps a command-triggered part opt-in at shooting time and retains its trigger requirement", () => {
    const result = buffs("fixture-command-part", { phase: "shooting" });
    expect(result.applied).toBe(0);
    expect(result.levers).toHaveLength(1);
    expect(result.levers[0]).toMatchObject({
      buffs: 1,
      requires: [{
        type: "ability-part",
        trigger: { event: "phase-started", condition: { type: "phase-is", parameters: { phase: "command" } } },
      }],
    });
  });

  it("keeps a phase condition inside the effect as ongoing buff applicability", () => {
    expect(buffs("fixture-phase-effect", { phase: "fight" })).toEqual({ applied: 1, levers: [] });
    expect(buffs("fixture-phase-effect", { phase: "shooting" })).toEqual({ applied: 0, levers: [] });
  });


  it("gates on the moment when there is one, so a usage limit adds no second lever", () => {
    expect(buffs("fixture-moment")).toMatchObject({
      applied: 0,
      levers: [{ buffs: 1, group: { id: "fixture-moment?usage", maxActivations: 1 } }],
    });
  });

  it("applies an attack-step trigger to every attack", () => {
    expect(buffs("fixture-attack-step")).toEqual({ applied: 1, levers: [] });
  });

  it("reads a unit's own Charge move from the context, not as a choice", () => {
    expect(buffs("fixture-charge", { phase: "fight", attackerCharged: true })).toEqual({ applied: 1, levers: [] });
    expect(buffs("fixture-charge", { phase: "fight", attackerCharged: false })).toEqual({ applied: 0, levers: [] });
  });
});

