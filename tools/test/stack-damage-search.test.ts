import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/dataset.js";
import type { WargearOption } from "../src/generated.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { exhaustiveLevers, exhaustiveLoadout } from "../src/stack-damage/exhaustive.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import { searchLevers, type LeverSpace, type SearchLever } from "../src/stack-damage/lever-search.js";
import { searchLoadout, type LoadoutSpace } from "../src/stack-damage/loadout-search.js";
import { damageScoringSession, legalDetachmentSpec } from "../src/stack-damage/search.js";

type Scored = { total: number; selected: string[] };

/** Additive lever values; `groups` hold at most one selected lever each. */
function additiveSpace(values: Record<string, number>, groups: string[][], extra: { enabled?: string[]; requires?: Record<string, string> } = {}): LeverSpace<Scored> {
  const levers: SearchLever[] = Object.keys(values).map((id) => ({
    id,
    ...(extra.enabled?.includes(id) ? { enabled: true } : {}),
    ...(extra.requires?.[id] ? { requiresLever: extra.requires[id] } : {}),
  }));
  return {
    levers,
    legal: (selected) => groups.every((group) => group.filter((id) => selected.includes(id)).length <= 1) &&
      selected.every((id) => !extra.requires?.[id] || selected.includes(extra.requires[id])),
    score: (selected) => ({ total: selected.reduce((sum, id) => sum + values[id]!, 0), selected: [...selected].sort() }),
  };
}

describe("lever search", () => {
  it("swaps an exclusive option that an earlier addition locked out", () => {
    // Taking `lethal` first is an improvement, after which `sustained` can only be reached by a swap.
    const space = additiveSpace({ lethal: 2, sustained: 6, aura: 3 }, [["lethal", "sustained"]]);
    expect(searchLevers(space).selected).toEqual(["aura", "sustained"]);
  });

  it("turns on the stance option a gated lever needs, swapping out the other option, and drops the gated lever with it", () => {
    const values: Record<string, number> = { push: 0, hold: 3, surge: 5 };
    const levers: SearchLever[] = [{ id: "push" }, { id: "hold" }, { id: "surge", requiresOption: "push" }];
    const space: LeverSpace<Scored> = {
      levers,
      legal: (selected) => !(selected.includes("push") && selected.includes("hold")) && (!selected.includes("surge") || selected.includes("push")),
      score: (selected) => ({ total: selected.reduce((sum, id) => sum + values[id]!, 0), selected: [...selected].sort() }),
    };
    expect(searchLevers(space).selected).toEqual(["push", "surge"]);
    values.surge = 2;
    expect(searchLevers(space).selected).toEqual(["hold"]);
    expect(searchLevers(space)).toEqual(exhaustiveLevers(space));
  });

  it("replaces the one usable Stratagem with a better one", () => {
    const space = additiveSpace({ first: 1, second: 4, rule: 2 }, [["first", "second"]]);
    expect(searchLevers(space)).toEqual(exhaustiveLevers(space));
  });

  it("removes an enabled lever that lowers the total, with the levers that require it", () => {
    const space = additiveSpace({ base: -5, child: 1, other: 2 }, [], { enabled: ["base", "child"], requires: { child: "base" } });
    expect(searchLevers(space).selected).toEqual(["other"]);
  });

  it("matches the exhaustive optimum on seeded additive spaces with exclusive groups", () => {
    let state = 0x9e3779b9;
    const random = () => {
      state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
      return state / 4294967296;
    };
    for (let trial = 0; trial < 200; trial++) {
      const ids = Array.from({ length: 3 + Math.floor(random() * 7) }, (_, index) => `l${index}`);
      const values = Object.fromEntries(ids.map((id) => [id, Math.round((random() * 10 - 3) * 100) / 100]));
      const groups: string[][] = [];
      for (const id of ids) {
        if (random() < 0.6 && groups.length > 0) groups[Math.floor(random() * groups.length)]!.push(id);
        else groups.push([id]);
      }
      const space = additiveSpace(values, groups, { enabled: ids.filter(() => random() < 0.3) });
      expect(searchLevers(space).total, `trial ${trial}`).toBeCloseTo(exhaustiveLevers(space).total, 9);
    }
  });
});

describe("loadout search", () => {
  it("takes two options on the same weapon together when neither pays off alone", () => {
    const options = [
      { id: "a", replaces: ["x"], replacement: ["y"] },
      { id: "b", replaces: ["x"], replacement: ["v"] },
    ] as unknown as WargearOption[];
    const value = (counts: ReadonlyMap<string, number>) => {
      const has = (id: string) => (counts.get(id) ?? 0) > 0;
      return has("y") && has("v") ? 12 : has("y") || has("v") ? 9 : 10;
    };
    const space: LoadoutSpace<{ total: number }> = {
      scaffold: { models: [], modelCount: 1, options, caps: [1, 1], base: new Map([["x", 2]]) },
      legal: () => true,
      score: (counts) => ({ total: value(counts) }),
    };
    expect(searchLoadout(space).total).toBe(12);
    expect(exhaustiveLoadout(space).total).toBe(12);
  });
});

describe("stack-damage search against the exhaustive oracle", () => {
  const dataset = Dataset.embedded();
  const cell = (factionId: string, targetId: string, unitId: string, detachmentId: string) => {
    const faction = resolveFactionContext(dataset, factionId);
    const target = resolveTarget(dataset, dataset.targetProfiles.get(targetId)!)!;
    const config = parseMatrixConfig(
      { HC_FACTIONS: factionId, HC_TARGETS: targetId, HC_PHASES: "shooting", HC_OUTPUT: "search-oracle.json" },
      { factionIds: new Set([factionId]), targetIds: [targetId] },
    );
    const session = damageScoringSession({ dataset, config, faction, target, phase: "shooting" });
    const unit = faction.units.find((candidate) => candidate.id === unitId)!;
    const spec = legalDetachmentSpec(session, factionId, [{ unit, role: "bodyguard" }], [dataset.detachments.getAny(detachmentId)!])!;
    return { session, spec };
  };

  it("chooses Dark Pacts' Sustained Hits over the Lethal Hits it would add first", () => {
    const { session, spec } = cell("chaos-space-marines", "meq-intercessors", "defiler", "veterans-of-the-long-war");
    const best = session.optimiseLevers(spec);
    expect(best.total).toBeCloseTo(exhaustiveLevers(session.leverSpace(spec)).total, 9);
    expect(best.spec.selectedLeverIds).toContain("dark-pacts-chaos-space-marines?1");
    expect(best.spec.selectedLeverIds).not.toContain("dark-pacts-chaos-space-marines?0");
  });

  it("reaches Unshackled Wrath's combined option and the optimal loadout", () => {
    const { session, spec } = cell("adeptus-mechanicus", "geq-guardsmen", "skitarii-rangers", "eradication-cohort");
    const best = session.optimiseLevers(spec);
    expect(best.total).toBeCloseTo(exhaustiveLevers(session.leverSpace(spec)).total, 9);
    expect(best.spec.selectedLeverIds).toContain("unshackled-wrath-eradication-cohort-adeptus-mechanicus?2");
    const pool = session.pool(spec);
    const member = best.members[0]!;
    const buffs = [
      ...pool.levers.filter((lever) => best.spec.selectedLeverIds.includes(lever.id)).flatMap((lever) => lever.perMember.get(member.member.unit.id) ?? []),
      ...session.defensiveBuffs,
    ];
    const space = session.loadoutSpace(member.member.unit, buffs, session.state.contextFor(best.spec, member.member));
    expect(member.loadout.total).toBeCloseTo(exhaustiveLoadout(space).total, 9);
  });
});
