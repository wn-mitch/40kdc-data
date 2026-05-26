import { describe, it, expect } from "vitest";
import {
  bump,
  portUnit,
  portEnhancement,
  portDetachment,
  portLeaderAttachment,
  coverGrants,
  chargeTimingTypes,
  referencesOneInch,
  TARGET_GAME_VERSION,
} from "../src/port-10e-faction.js";
import { KNOWN_SUPPORT_10E, knownSupportSet } from "../src/known-support-10e.js";

const v10 = { edition: "10th", dataslate: "2025-q3" };

describe("bump", () => {
  it("rewrites game_version to the provisional 11e dataslate", () => {
    const out = bump({ id: "x", game_version: v10 });
    expect(out.game_version).toEqual({ edition: "11th", dataslate: "pre-launch-provisional" });
    expect(out.game_version).toEqual(TARGET_GAME_VERSION);
  });

  it("preserves all other fields", () => {
    const out = bump({ id: "x", name: "X", profiles: [{ M: 6 }], game_version: v10 });
    expect(out.id).toBe("x");
    expect(out.name).toBe("X");
    expect(out.profiles).toEqual([{ M: 6 }]);
  });
});

describe("portUnit", () => {
  const leaders = new Set(["painboy", "warboss", "apothecary"]);
  const support = new Set(["apothecary", "cryptothralls"]);

  it("marks points provisional and stamps 11e", () => {
    const out = portUnit(
      { id: "boyz", role: "battleline", points: [{ models: 10, cost: 80 }], game_version: v10 },
      leaders,
      support,
    );
    expect(out.points_provisional).toBe(true);
    expect(out.game_version).toEqual(TARGET_GAME_VERSION);
  });

  it("sets attachment_role 'leader' for an attaching character not in the registry", () => {
    const out = portUnit({ id: "warboss", role: "character", game_version: v10 }, leaders, support);
    expect(out.attachment_role).toBe("leader");
  });

  it("sets attachment_role 'support' when the unit is in the registry", () => {
    const out = portUnit({ id: "apothecary", role: "character", game_version: v10 }, leaders, support);
    expect(out.attachment_role).toBe("support");
  });

  it("assigns 'support' even when the unit isn't a leader_id (cryptothralls case)", () => {
    const out = portUnit({ id: "cryptothralls", role: "battleline", game_version: v10 }, leaders, support);
    expect(out.attachment_role).toBe("support");
  });

  it("leaves non-attaching units with no role", () => {
    const out = portUnit({ id: "boyz", role: "battleline", game_version: v10 }, leaders, support);
    expect(out.attachment_role).toBeUndefined();
  });
});

describe("portEnhancement", () => {
  it("default-fills upgrade_tag/max_targets and marks the cost provisional", () => {
    const out = portEnhancement({ id: "e", name: "E", detachment_id: "d", cost: 25, game_version: v10 });
    expect(out.points_provisional).toBe(true);
    expect(out.upgrade_tag).toBe(false);
    expect(out.max_targets).toBe(1);
    expect(out.game_version).toEqual(TARGET_GAME_VERSION);
  });
});

describe("portDetachment", () => {
  it("default-fills detachment_points null and force_dispositions []", () => {
    const out = portDetachment({ id: "d", name: "D", faction_id: "orks", game_version: v10 });
    expect(out.detachment_points).toBeNull();
    expect(out.force_dispositions).toEqual([]);
  });
});

describe("portLeaderAttachment", () => {
  it("drops the retired max_leaders_per_unit field", () => {
    const out = portLeaderAttachment({
      leader_id: "weirdboy",
      eligible_bodyguard_ids: ["boyz"],
      max_leaders_per_unit: 1,
      game_version: v10,
    });
    expect("max_leaders_per_unit" in out).toBe(false);
    expect(out.leader_id).toBe("weirdboy");
    expect(out.eligible_bodyguard_ids).toEqual(["boyz"]);
    expect(out.game_version).toEqual(TARGET_GAME_VERSION);
  });
});

describe("KNOWN_SUPPORT_10E registry", () => {
  it("flattens to a faction-prefixed id set for membership tests", () => {
    const set = knownSupportSet();
    // Layer 1 (army-assist): canonical SM medic / Ancient line.
    expect(set.has("adeptus-astartes:apothecary")).toBe(true);
    expect(set.has("adeptus-astartes:sanguinary-priest")).toBe(true);
    expect(set.has("adeptus-astartes:lieutenant")).toBe(true);
    // Layer 2 (manual overlay): scrape-gap + non-character special cases.
    expect(set.has("tau-empire:kroot-war-shaper")).toBe(true);
    expect(set.has("necrons:cryptothralls")).toBe(true);
    // Confirmed-not-support: primary Leaders / FNP false positives.
    expect(set.has("orks:warboss")).toBe(false);
    expect(set.has("orks:painboy")).toBe(false);
    expect(set.has("adeptus-mechanicus:tech-priest-dominus")).toBe(false);
  });

  it("uses kebab-case unit ids matching the entity-id pattern", () => {
    const idPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
    for (const [faction, ids] of Object.entries(KNOWN_SUPPORT_10E)) {
      expect(idPattern.test(faction)).toBe(true);
      for (const id of ids) expect(idPattern.test(id)).toBe(true);
    }
  });
});

describe("ability audit detectors", () => {
  it("coverGrants flags an ability-grant of benefit-of-cover", () => {
    const eff = {
      type: "conditional",
      condition: { type: "phase-is", parameters: { phase: "shooting" } },
      effect: { type: "ability-grant", target: "unit", modifier: { ability_id: "benefit-of-cover" } },
    };
    expect(coverGrants(eff)).toContain("benefit-of-cover");
  });

  it("chargeTimingTypes flags fight-first / charged-this-turn", () => {
    expect(chargeTimingTypes({ type: "fight-first" })).toContain("fight-first");
    expect(chargeTimingTypes({ type: "stat-modifier" })).toEqual([]);
  });

  it("referencesOneInch detects the 10e 1-inch engagement constant", () => {
    expect(referencesOneInch({ scope: { range: '1"' } })).toBe(true);
    expect(referencesOneInch({ scope: { range: '12"' } })).toBe(false);
  });
});
