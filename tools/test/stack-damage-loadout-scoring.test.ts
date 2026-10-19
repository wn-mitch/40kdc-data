import { describe, expect, it } from "vitest";

import type { EngineContext } from "../src/cruncher/index.js";
import type { Weapon } from "../src/generated.js";
import { scoreLoadoutWeapons } from "../src/stack-damage/loadout-scoring.js";

const GV = { edition: "11th", dataslate: "launch" } as const;

function meleeWeapon(
  id: string,
  extraAttacks = false,
): Weapon {
  return {
    id,
    name: id,
    type: "melee",
    profiles: [{
      name: "melee",
      range: "Melee",
      stats: { A: 1, WS: 2, S: 4, AP: 0, D: 1 },
      keywords: extraAttacks ? [{ keyword_id: "extra-attacks" }] : [],
    }],
    game_version: GV,
  } as Weapon;
}

describe("scoreLoadoutWeapons", () => {
  it("chooses one ordinary melee weapon per model and adds every Extra Attacks weapon", () => {
    const context: EngineContext = {
      phase: "fight",
      attackerCharged: true,
      distanceInches: 1,
    };
    const seenContexts: EngineContext[] = [];
    const damage: Record<string, number> = {
      sword: 4,
      knife: 1,
      servo: 2,
    };
    const result = scoreLoadoutWeapons({
      phase: "fight",
      modelCount: 3,
      context,
      weapons: [
        { weapon: meleeWeapon("sword"), count: 2 },
        { weapon: meleeWeapon("knife"), count: 3 },
        { weapon: meleeWeapon("servo", true), count: 2 },
      ],
      scoreProfile: ({ weapon, context: received }) => {
        seenContexts.push(received);
        return { damage: damage[weapon.id] };
      },
    });

    expect(result.total).toBe(13);
    expect(result.selected.map(({ weaponId, count }) => [weaponId, count])).toEqual([
      ["servo", 2],
      ["knife", 1],
      ["sword", 2],
    ]);
    expect(seenContexts).toHaveLength(3);
    expect(seenContexts.every((received) => received === context)).toBe(true);
  });

  it("scores every ranged weapon rather than applying melee choice rules", () => {
    const ranged = (id: string): Weapon => ({
      ...meleeWeapon(id),
      type: "ranged",
      profiles: [{
        name: "ranged",
        range: 24,
        stats: { A: 1, BS: 3, S: 4, AP: 0, D: 1 },
      }],
    }) as Weapon;
    const result = scoreLoadoutWeapons({
      phase: "shooting",
      modelCount: 1,
      context: { phase: "shooting" },
      weapons: [
        { weapon: ranged("rifle"), count: 2 },
        { weapon: ranged("pistol"), count: 1 },
      ],
      scoreProfile: ({ weapon }) => ({ damage: weapon.id === "rifle" ? 2 : 3 }),
    });
    expect(result.total).toBe(7);
    expect(result.selected).toHaveLength(2);
  });
});
