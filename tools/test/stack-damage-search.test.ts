import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/dataset.js";
import type { WargearOption } from "../src/generated.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { exhaustiveLevers, exhaustiveLoadout } from "../src/stack-damage/exhaustive.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import { searchLevers, type LeverSpace, type SearchLever } from "../src/stack-damage/lever-search.js";
import { countsKey, MFM_EXHAUSTIVE_LOADOUTS, mfmCandidates, searchLoadout, type LoadoutSpace, type MfmLoadouts } from "../src/stack-damage/loadout-search.js";
import { phaseScoredItem } from "../src/stack-damage/weapon-grants.js";
import { damageScoringSession, deepOptimise, detachmentCombos, emptySpec, legalDetachmentSpec } from "../src/stack-damage/search.js";

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
      scaffold: { models: [], modelCount: 1, options, caps: [1, 1], base: new Map([["x", 2]]), carriable: ["v", "x", "y"] },
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

  it("finds the exhaustive best of all 31k Legionaries loadouts by searching their melee candidates", () => {
    const faction = resolveFactionContext(dataset, "chaos-space-marines");
    const target = resolveTarget(dataset, dataset.targetProfiles.get("meq-intercessors")!)!;
    const config = parseMatrixConfig(
      { HC_FACTIONS: "chaos-space-marines", HC_TARGETS: "meq-intercessors", HC_PHASES: "fight", HC_OUTPUT: "search-oracle.json" },
      { factionIds: new Set(["chaos-space-marines"]), targetIds: ["meq-intercessors"] },
    );
    const session = damageScoringSession({ dataset, config, faction, target, phase: "fight" });
    const unit = faction.units.find((candidate) => candidate.id === "legionaries")!;
    const spec = { factionId: "chaos-space-marines", members: [{ unit, role: "bodyguard" as const }], detachmentIds: [], selectedLeverIds: [], detachmentIssues: [] };
    const space = session.loadoutSpace(unit, session.defensiveBuffs, session.state.contextFor(spec, spec.members[0]));
    expect(space.scaffold.mfm!.loadouts.length).toBeGreaterThan(30_000);
    expect(space.scaffold.mfmCandidates!.length).toBeLessThanOrEqual(MFM_EXHAUSTIVE_LOADOUTS);
    expect(searchLoadout(space).total).toBeCloseTo(exhaustiveLoadout(space).total, 9);
  });

  it("skips detachments idle alone without losing any combination's best", () => {
    const faction = resolveFactionContext(dataset, "adeptus-custodes");
    const target = resolveTarget(dataset, dataset.targetProfiles.get("questoris-knight")!)!;
    const config = parseMatrixConfig(
      { HC_FACTIONS: "adeptus-custodes", HC_TARGETS: "questoris-knight", HC_PHASES: "fight", HC_OUTPUT: "search-oracle.json" },
      { factionIds: new Set(["adeptus-custodes"]), targetIds: ["questoris-knight"] },
    );
    const session = damageScoringSession({ dataset, config, faction, target, phase: "fight" });
    const detachments = faction.lineage.flatMap((id) => dataset.detachments.byFaction(id)).sort((left, right) => left.id.localeCompare(right.id));
    const combinations = detachmentCombos(detachments, config);
    expect(combinations.length).toBeGreaterThan(100);
    for (const unitId of ["custodian-guard-sodality", "allarus-custodians", "custodian-wardens"]) {
      const members = [{ unit: faction.units.find((candidate) => candidate.id === unitId)!, role: "bodyguard" as const }];
      let full = session.optimiseLevers(emptySpec("adeptus-custodes", members)).total;
      for (const combination of combinations.filter((candidate) => candidate.length > 0)) {
        const spec = legalDetachmentSpec(session, "adeptus-custodes", members, combination);
        if (spec) full = Math.max(full, session.optimiseLevers(spec).total);
      }
      expect(deepOptimise(session, "adeptus-custodes", members, combinations).total).toBeCloseTo(full, 9);
    }
  });

  it("keeps only weapons and wargear that can score in the phase", () => {
    const unit = dataset.units.getInFaction("legionaries", "chaos-space-marines")!.raw;
    const shooting = phaseScoredItem(dataset, unit, "shooting");
    const fight = phaseScoredItem(dataset, unit, "fight");
    expect([shooting("astartes-chainsword"), fight("astartes-chainsword")]).toEqual([false, true]);
    expect([shooting("boltgun-legionaries"), fight("boltgun-legionaries")]).toEqual([true, false]);
    // Wargear stays in both phases: a rule may read it.
    expect([shooting("chaos-icon"), fight("chaos-icon")]).toEqual([true, true]);
  });

  it("ignores another faction's ability naming a same-id weapon", () => {
    // Aeldari's Breath of Vaul names its own `flamer`; the Legionaries' flamer is a different weapon.
    expect(JSON.stringify(dataset.abilities.getInFaction("breath-of-vaul-guardian-battlehost-aeldari", "aeldari")!.raw)).toContain('"flamer"');
    const unit = dataset.units.getInFaction("legionaries", "chaos-space-marines")!.raw;
    expect([phaseScoredItem(dataset, unit, "shooting")("flamer"), phaseScoredItem(dataset, unit, "fight")("flamer")]).toEqual([true, false]);
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

/** A fabricated MFM space: the listed loadouts, scored by `value`, starting from the first. */
function mfmSpace(loadouts: Map<string, number>[], value: (counts: ReadonlyMap<string, number>) => number): LoadoutSpace<{ total: number; counts: Map<string, number> }> {
  const mfm: MfmLoadouts = { loadouts: loadouts.map((counts) => ({ counts, groups: null })), byKey: new Map(loadouts.map((counts, at) => [countsKey(counts), at])) };
  return {
    scaffold: { models: [], modelCount: 10, options: [], caps: [], base: loadouts[0], carriable: [], mfm },
    legal: (counts) => mfm.byKey.has(countsKey(counts)),
    score: (counts) => ({ total: value(counts), counts: new Map(counts) }),
  };
}

describe("loadout search under MFM rules", () => {
  // n plasma guns displace n boltguns on ten models; `gun` caps how many specials a loadout takes.
  const lineOf = (guns: number, extra: Record<string, number> = {}) => new Map(Object.entries({ boltgun: 10 - guns, "plasma-gun": guns, ...extra }).filter(([, n]) => n > 0));

  it("scores a short list whole, keeping the base on a tie", () => {
    const loadouts = [lineOf(0), lineOf(1), lineOf(2)];
    const flat = mfmSpace(loadouts, () => 5);
    expect(searchLoadout(flat).counts).toEqual(lineOf(0));
    // The best loadout is two swaps away, past a worse one: the whole list finds it.
    const dip = mfmSpace(loadouts, (counts) => [10, 4, 20][counts.get("plasma-gun") ?? 0]);
    expect(searchLoadout(dip).counts).toEqual(lineOf(2));
    expect(exhaustiveLoadout(dip).total).toBe(20);
  });

  it("climbs a long list through nearer loadouts first, then wider moves", () => {
    // More loadouts than are scored whole: an unscored tag spreads each gun count over many keys.
    // Guns come in pairs, so every improving move is L1 4 away: radius 2 alone would stop at the base.
    const loadouts: Map<string, number>[] = [];
    for (let guns = 0; guns <= 10; guns += 2) for (let tag = 0; tag < 100; tag++) loadouts.push(lineOf(guns, { tag }));
    expect(loadouts.length).toBeGreaterThan(MFM_EXHAUSTIVE_LOADOUTS);
    const space = mfmSpace(loadouts, (counts) => (counts.get("plasma-gun") ?? 0) * 3 - (counts.get("tag") ?? 0) * 0.001);
    const best = searchLoadout(space);
    expect(best.counts.get("plasma-gun")).toBe(10);
    expect(best.total).toBeCloseTo(exhaustiveLoadout(space).total, 9);
  });
});

describe("MFM loadout candidates", () => {
  const scores = (id: string) => id !== "chainsword";
  const group = (count: number, ...weapons: string[]) => ({ model_name: "Legionary", count, weapons: weapons.map((id) => ({ id, count: 1 })) });
  const loadout = (groups: ReturnType<typeof group>[]) => {
    const counts = new Map<string, number>();
    for (const { count, weapons } of groups) for (const { id } of weapons) counts.set(id, (counts.get(id) ?? 0) + count);
    return { counts, groups };
  };

  it("merges loadouts that differ only in unscored items, standing for them by the one nearest the base", () => {
    const base = loadout([group(2, "boltgun", "pistol")]);
    const far = loadout([group(2, "boltgun", "pistol", "chainsword")]);
    const near = loadout([group(1, "boltgun", "pistol", "chainsword"), group(1, "boltgun", "pistol")]);
    const mfm: MfmLoadouts = { loadouts: [far, base, near], byKey: new Map() };
    const candidates = mfmCandidates(mfm, base.counts, scores);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].counts).toBe(base.counts);
    expect(candidates[0].scored).toEqual(new Map([["boltgun", 2], ["pistol", 2]]));
  });

  it("keeps apart loadouts with the same scored counts carried by different models", () => {
    // Pistols are fired instead of other guns model by model, so who carries what is scored.
    const together = loadout([group(1, "boltgun", "pistol"), group(1)]);
    const apart = loadout([group(1, "boltgun"), group(1, "pistol")]);
    const mfm: MfmLoadouts = { loadouts: [together, apart], byKey: new Map() };
    expect(mfmCandidates(mfm, together.counts, scores)).toHaveLength(2);
  });
});
