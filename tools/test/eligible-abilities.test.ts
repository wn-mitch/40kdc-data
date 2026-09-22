import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";

const ds = Dataset.embedded();

describe("Dataset.eligibleAbilities", () => {
  it("surfaces the Combat Doctrines faction rule for adeptus-astartes units", () => {
    const intercessor = ds.units.find("Intercessor Squad");
    expect(intercessor, "intercessor-squad missing").toBeDefined();
    const result = ds.eligibleAbilities(
      { unitId: intercessor!.id, factionId: "adeptus-astartes" },
      "shooting",
    );
    const armyIds = result.filter((e) => e.source.kind === "army").map((e) => e.ability.id);
    expect(armyIds).toContain("combat-doctrines");
  });

  it("returns nothing for an unknown unit", () => {
    expect(ds.eligibleAbilities({ unitId: "no-such-unit" }, "shooting")).toEqual([]);
  });

  it("filters by phase", () => {
    const intercessor = ds.units.find("Intercessor Squad")!;
    // The army rule is phase-permissive (no explicit phase-mapping), so the
    // resolver keeps it available everywhere. This test pins that
    // "no mapping = surface in every phase" behaviour against tightening.
    const inCommand = ds.eligibleAbilities(
      { unitId: intercessor.id, factionId: "adeptus-astartes" },
      "command",
    );
    const armyIds = inCommand.filter((e) => e.source.kind === "army").map((e) => e.ability.id);
    expect(armyIds).toContain("combat-doctrines");
  });

  it("includes the unit's own ability_ids", () => {
    // Use Khârn — first-wins by-id lookup returns the same record `units.all`
    // surfaces, and the record has abilities baked in. Avoids the
    // `(faction_id, id)`-dedup vs `byId` first-wins mismatch other units hit.
    const unitId = "kharn-the-betrayer";
    expect((ds.units.getAny(unitId)?.raw.ability_ids ?? []).length).toBeGreaterThan(0);
    const result = ds.eligibleAbilities({ unitId }, "fight");
    const unitAbilities = result.filter((e) => e.source.kind === "unit");
    expect(unitAbilities.length).toBeGreaterThan(0);
  });

  it("sorts entries by source kind (army → detachment → unit → attached → support)", () => {
    const intercessor = ds.units.find("Intercessor Squad")!;
    const result = ds.eligibleAbilities(
      { unitId: intercessor.id, factionId: "adeptus-astartes" },
      "shooting",
    );
    const order = ["army", "detachment", "detachment-stratagem", "unit", "attached", "support"];
    const positions = result.map((e) => order.indexOf(e.source.kind));
    // Each successive position must be >= the previous one (non-decreasing).
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i] >= positions[i - 1],
        `entry ${i} (${result[i].source.kind}) breaks sort order`,
      ).toBe(true);
    }
  });

  // The combined-unit attachment is bidirectional: whichever half is the
  // selected unit, the *other* half's abilities are pooled in as `attached`.
  it("pools an attached leader's abilities onto the selected bodyguard", () => {
    const result = ds.eligibleAbilities(
      { unitId: "khorne-berzerkers", attachedUnitIds: ["kharn-the-betrayer"] },
      "fight",
    );
    const attached = result.filter(
      (e) => e.source.kind === "attached" && e.source.unitId === "kharn-the-betrayer",
    );
    expect(attached.length).toBeGreaterThan(0);
    // And the bodyguard's own abilities still come through as `unit`.
    expect(result.some((e) => e.source.kind === "unit")).toBe(true);
  });

  it("pools an attached bodyguard's abilities onto the selected leader (reverse direction)", () => {
    const result = ds.eligibleAbilities(
      { unitId: "kharn-the-betrayer", attachedUnitIds: ["khorne-berzerkers"] },
      "fight",
    );
    const attached = result.filter(
      (e) => e.source.kind === "attached" && e.source.unitId === "khorne-berzerkers",
    );
    expect(attached.length).toBeGreaterThan(0);
  });
});

describe("Dataset.buffsFor (M2 — abilities)", () => {
  it("Combat Doctrines is a stance: nothing auto-applies, Devastator surfaces as a lever", () => {
    const intercessor = ds.units.find("Intercessor Squad")!;
    const ctx = { phase: "shooting" as const };
    const input = { unitId: intercessor.id, factionId: "adeptus-astartes" };
    // The army rule is a player-selected stance, so the attacker walk applies
    // no army-sourced buff — a passive reroll here would mean the rule was
    // modelled as always-on again.
    const armyBuffs = ds
      .buffsFor(input, ctx)
      .filter((b) => b.source.kind === "ability" && b.source.abilityKind === "army");
    expect(armyBuffs).toEqual([]);
    // Its one buff-bearing option is offered as a mutually-exclusive lever.
    const { buffs: levers } = ds.stackableBuffsFor(input, ctx);
    const devastator = levers.find((l) => l.id === "combat-doctrines#Devastator Doctrine");
    expect(devastator, "Devastator Doctrine lever missing").toBeDefined();
    expect(devastator!.group).toBe("combat-doctrines?stance");
  });

  it("respects optedInStratagemIds — stratagems are excluded by default", () => {
    const intercessor = ds.units.find("Intercessor Squad")!;
    const withoutStrat = ds.buffsFor(
      { unitId: intercessor.id, factionId: "adeptus-astartes", detachmentId: "gladius-task-force" },
      { phase: "shooting" },
    );
    const stratBuffs = withoutStrat.filter(
      (b) =>
        b.source.kind === "ability" && b.source.abilityKind === "detachment-stratagem",
    );
    expect(stratBuffs).toEqual([]);
  });

  it("concatenates weapon-profile keyword buffs with ability buffs", () => {
    const intercessor = ds.units.find("Intercessor Squad")!;
    const base = { unitId: intercessor.id, factionId: "adeptus-astartes" };
    const ctx = { phase: "shooting" as const, attackerStationary: true };
    const withoutWeapon = ds.buffsFor(base, ctx);
    const withWeapon = ds.buffsFor(
      { ...base, weaponProfiles: [{ weaponId: "bolt-rifle", profileIndex: 0 }] },
      ctx,
    );
    // The profile's Heavy (stationary) keyword contributes a buff the bare
    // ability walk does not produce: the two sources concatenate onto one stack.
    const keywords = (bs: typeof withWeapon) =>
      bs.map((b) => `${b.source.kind}:${"keywordId" in b.source ? b.source.keywordId : ""}`);
    expect(keywords(withWeapon)).toContain("weapon-keyword:heavy");
    expect(keywords(withoutWeapon)).not.toContain("weapon-keyword:heavy");
    expect(withWeapon.length).toBeGreaterThan(withoutWeapon.length);
  });
});
