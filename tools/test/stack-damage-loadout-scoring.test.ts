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

  const ranged = (id: string, pistol = false): Weapon => ({
    ...meleeWeapon(id),
    type: "ranged",
    profiles: [{
      name: "ranged",
      range: 24,
      stats: { A: 1, BS: 3, S: 4, AP: 0, D: 1 },
      keywords: pistol ? [{ keyword_id: "pistol" }] : [],
    }],
  }) as Weapon;
  const shooting = (input: {
    modelCount: number;
    weapons: [Weapon, number][];
    damage: Record<string, number>;
    pistolsExclusive?: boolean;
    inEngagementRange?: boolean;
    groups?: { count: number; weapons: { id: string; count: number }[] }[] | null;
  }) => scoreLoadoutWeapons({
    phase: "shooting",
    modelCount: input.modelCount,
    context: { phase: "shooting" },
    weapons: input.weapons.map(([weapon, count]) => ({ weapon, count })),
    scoreProfile: ({ weapon }) => ({ damage: input.damage[weapon.id] }),
    pistolsExclusive: input.pistolsExclusive ?? true,
    inEngagementRange: input.inEngagementRange,
    groups: input.groups,
  });
  const fired = (result: ReturnType<typeof scoreLoadoutWeapons>) =>
    result.selected.map(({ weaponId, count }) => [weaponId, count]);

  it("lets each model fire its Pistols or its other ranged weapons, whichever deals more", () => {
    const result = shooting({
      modelCount: 5,
      weapons: [[ranged("rifle"), 3], [ranged("cannon"), 2], [ranged("pistol", true), 5]],
      damage: { rifle: 2, cannon: 5, pistol: 3 },
      groups: [
        { count: 3, weapons: [{ id: "rifle", count: 1 }, { id: "pistol", count: 1 }] },
        { count: 2, weapons: [{ id: "cannon", count: 1 }, { id: "pistol", count: 1 }] },
      ],
    });
    expect(result.total).toBe(19);
    expect(fired(result)).toEqual([["cannon", 2], ["pistol", 3]]);
    expect(result.pistolChoice).toBe("per-model");
  });

  it("keeps the other ranged weapons on a tie", () => {
    const result = shooting({
      modelCount: 1,
      weapons: [[ranged("rifle"), 1], [ranged("pistol", true), 1]],
      damage: { rifle: 3, pistol: 3 },
    });
    expect(fired(result)).toEqual([["rifle", 1]]);
    expect(result.pistolChoice).toBe("per-model");
  });

  it("makes one unit-wide choice when per-model loadouts are unknown", () => {
    // Per model the optimum might mix; without groups the unit fires one side.
    const result = shooting({
      modelCount: 4,
      weapons: [[ranged("rifle"), 2], [ranged("pistol", true), 4]],
      damage: { rifle: 5, pistol: 1 },
    });
    expect(result.total).toBe(10);
    expect(result.pistolChoice).toBe("unit-wide");
  });

  it("does not apply the rule to a model with only Pistols", () => {
    const result = shooting({
      modelCount: 2,
      weapons: [[ranged("rifle"), 1], [ranged("pistol", true), 1]],
      damage: { rifle: 2, pistol: 3 },
      groups: [
        { count: 1, weapons: [{ id: "rifle", count: 1 }] },
        { count: 1, weapons: [{ id: "pistol", count: 1 }] },
      ],
    });
    expect(result.total).toBe(5);
    expect(result.pistolChoice).toBe("none");
  });

  it("fires only Pistols within Engagement Range, even when the other weapons deal more", () => {
    const result = shooting({
      modelCount: 3,
      weapons: [[ranged("rifle"), 3], [ranged("pistol", true), 2]],
      damage: { rifle: 5, pistol: 1 },
      inEngagementRange: true,
      groups: [
        { count: 2, weapons: [{ id: "rifle", count: 1 }, { id: "pistol", count: 1 }] },
        { count: 1, weapons: [{ id: "rifle", count: 1 }] },
      ],
    });
    expect(result.total).toBe(2);
    expect(fired(result)).toEqual([["pistol", 2]]);
    expect(result.pistolChoice).toBe("engaged");
  });

  it("fires every ranged weapon of an engaged Monster or Vehicle, at -1 to hit for non-Pistols", () => {
    const seen: [string, number | undefined][] = [];
    const result = scoreLoadoutWeapons({
      phase: "shooting",
      modelCount: 1,
      context: { phase: "shooting" },
      weapons: [{ weapon: ranged("cannon"), count: 1 }, { weapon: ranged("pistol", true), count: 1 }],
      scoreProfile: ({ weapon, hitModifier }) => {
        seen.push([weapon.id, hitModifier]);
        // A scorer honouring the modifier: the cannon loses a third of its hits.
        return { damage: weapon.id === "cannon" ? (hitModifier === -1 ? 4 : 6) : 1 };
      },
      pistolsExclusive: false,
      inEngagementRange: true,
    });
    expect(seen).toEqual([["cannon", -1], ["pistol", undefined]]);
    expect(result.total).toBe(5);
    expect(result.pistolChoice).toBe("engaged");
  });

  it("sums every ranged weapon for a Monster or Vehicle", () => {
    const result = shooting({
      modelCount: 1,
      weapons: [[ranged("rifle"), 2], [ranged("pistol", true), 1]],
      damage: { rifle: 2, pistol: 3 },
      pistolsExclusive: false,
    });
    expect(result.total).toBe(7);
    expect(result.selected).toHaveLength(2);
    expect(result.pistolChoice).toBe("none");
  });
});
