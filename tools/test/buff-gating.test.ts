import { describe, expect, it } from "vitest";

import { Dataset, emptyRawData } from "../src/data/index.js";

// Fabricated abilities: the same five are pinned in the Python and Go data-model tests.
const reroll = { type: "re-roll", target: "unit", modifier: { roll: "hit", subset: "ones" } };
function dataset() {
  const raw = emptyRawData();
  raw.abilities = [
    { ability_id: "fixture-usage", name: "Fixture Usage", faction_id: "orks", behavior: "passive", usage: { frequency: "n-per-battle", count: 1 }, effect: reroll },
    { ability_id: "fixture-stratagem", name: "Fixture Stratagem", faction_id: "orks", ability_type: "stratagem", behavior: "activated", usage: { frequency: "once-per-turn" }, effect: reroll },
    { ability_id: "fixture-moment", name: "Fixture Moment", faction_id: "orks", behavior: "reactive", trigger: { event: "selected", filter: { to: "shoot" } }, usage: { frequency: "once-per-turn" }, effect: reroll },
    { ability_id: "fixture-attack-step", name: "Fixture Attack Step", faction_id: "orks", behavior: "reactive", trigger: { event: "before-roll", subject: { owner: "any" }, filter: { roll: "hit" } }, effect: reroll },
    { ability_id: "fixture-charge", name: "Fixture Charge", faction_id: "orks", behavior: "reactive", trigger: { event: "move-ended", filter: { move_types: ["charge"] } }, effect: reroll },
  ] as never;
  return new Dataset(raw);
}
const buffs = (id: string, context: Record<string, unknown> = { phase: "fight" }) => {
  const ability = dataset().abilities.getInFaction(id, "orks")!;
  const result = ability.describeBuffs({ kind: "ability", abilityId: id, abilityKind: "unit" } as never, context as never);
  return { applied: result.applied.length, levers: result.activatable.map((lever) => lever.id) };
};

describe("ability-level gating of buffs", () => {
  it("makes a usage-limited buff an opt-in lever named for its limit", () => {
    expect(buffs("fixture-usage")).toEqual({ applied: 0, levers: ["fixture-usage@n-per-battle"] });
  });

  it("leaves a stratagem's buffs to the stratagem lever, whatever its usage", () => {
    expect(buffs("fixture-stratagem")).toEqual({ applied: 1, levers: [] });
  });

  it("gates on the moment when there is one, so a usage limit adds no second lever", () => {
    expect(buffs("fixture-moment")).toEqual({ applied: 0, levers: ["fixture-moment@selected:shoot"] });
  });

  it("applies an attack-step trigger to every attack", () => {
    expect(buffs("fixture-attack-step")).toEqual({ applied: 1, levers: [] });
  });

  it("reads a unit's own Charge move from the context, not as a choice", () => {
    expect(buffs("fixture-charge", { phase: "fight", attackerCharged: true })).toEqual({ applied: 1, levers: [] });
    expect(buffs("fixture-charge", { phase: "fight", attackerCharged: false })).toEqual({ applied: 0, levers: [] });
  });
});
