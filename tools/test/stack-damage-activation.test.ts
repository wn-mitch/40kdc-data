import { describe, expect, it } from "vitest";

import { resolveTarget } from "../src/compare.js";
import { Dataset } from "../src/data/index.js";
import { RAW_DATA } from "../src/data/bundle.generated.js";
import { parseMatrixConfig } from "../src/stack-damage/config.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";
import type { StackMember } from "../src/stack-damage/model.js";
import { combinedKeywords, orderIssuingUnits } from "../src/stack-damage/orders.js";
import { addOrderIssuers, damageScoringSession, emptySpec } from "../src/stack-damage/search.js";
import { assumedEligibility, unitLookup } from "../src/stack-damage/stratagem-eligibility.js";

const dataset = Dataset.embedded();
const TARGET = "meq-intercessors";
const sessions = new Map<string, ReturnType<typeof damageScoringSession>>();

function session(factionId: string, phase: "shooting" | "fight") {
  const key = `${factionId}:${phase}`;
  let found = sessions.get(key);
  if (!found) {
    const config = parseMatrixConfig(
      { HC_FACTIONS: factionId, HC_TARGETS: TARGET, HC_PHASES: phase, HC_OUTPUT: "stack-damage.json" },
      { factionIds: new Set([factionId]), targetIds: [TARGET] },
    );
    const target = resolveTarget(dataset, dataset.targetProfiles.get(TARGET)!)!;
    found = damageScoringSession({ dataset, config, faction: resolveFactionContext(dataset, factionId), target, phase });
    sessions.set(key, found);
  }
  return found;
}

function spec(factionId: string, detachmentId: string, unitIds: string[]) {
  const members = unitIds.map((id, index) => ({ unit: dataset.units.getInFaction(id, factionId)!, role: index === 0 ? "bodyguard" : "leader" })) as StackMember[];
  return emptySpec(factionId, members, [detachmentId]);
}

/** The ability ids of the levers the pool offers a stack. */
function offered(factionId: string, detachmentId: string, unitIds: string[], phase: "shooting" | "fight"): Set<string> {
  return new Set(session(factionId, phase).pool(spec(factionId, detachmentId, unitIds)).levers.flatMap((lever) =>
    lever.source.kind === "ability" ? [lever.source.abilityId] : []));
}

describe("stack damage activation events", () => {
  it("offers a used-Deep-Strike Stratagem only to a unit with Deep Strike", () => {
    const id = "purgation-pattern-brotherhood-strike-grey-knights";
    expect(offered("grey-knights", "brotherhood-strike", ["grey-knights-thunderhawk-gunship"], "shooting").has(id)).toBe(false);
    expect(offered("grey-knights", "brotherhood-strike", ["paladin-squad"], "shooting").has(id)).toBe(true);
  });

  it("offers a Deep Strike set-up trigger only to a unit with Deep Strike", () => {
    const id = "fury-of-titan-grey-knights";
    expect(offered("grey-knights", "brotherhood-strike", ["grey-knights-thunderhawk-gunship"], "shooting").has(id)).toBe(false);
    expect(offered("grey-knights", "brotherhood-strike", ["paladin-squad"], "shooting").has(id)).toBe(true);
  });

  it("offers a disembarked-this-turn Stratagem only to a unit that can embark", () => {
    const id = "opening-salvo-armoured-infantry-astra-militarum";
    expect(offered("astra-militarum", "armoured-infantry", ["shadowsword"], "shooting").has(id)).toBe(false);
    expect(offered("astra-militarum", "armoured-infantry", ["cadian-shock-troops"], "shooting").has(id)).toBe(true);
  });
});

describe("stack damage Orders", () => {
  const voice = "voice-of-command-astra-militarum";

  it("offers Orders only to a unit some Officer's Orders may target", () => {
    expect(offered("astra-militarum", "armoured-infantry", ["valkyrie"], "shooting").has(voice)).toBe(false);
    expect(offered("astra-militarum", "armoured-infantry", ["bullgryn-squad"], "shooting").has(voice)).toBe(false);
    expect(offered("astra-militarum", "armoured-infantry", ["doomhammer"], "shooting").has(voice)).toBe(true);
    expect(offered("astra-militarum", "armoured-infantry", ["cadian-shock-troops"], "shooting").has(voice)).toBe(true);
  });

  it("reads each Officer's eligible receivers: only some Officers can order a TITANIC unit", () => {
    const units = unitLookup(dataset, "astra-militarum");
    const officers = ["cadian-castellan", "commissar-yarrick", "leman-russ-commander", "lord-solar-leontus"];
    expect(orderIssuingUnits(dataset, voice, officers, combinedKeywords(["doomhammer"], units, undefined)))
      .toEqual(["commissar-yarrick", "lord-solar-leontus"]);
    expect(orderIssuingUnits(dataset, voice, officers, combinedKeywords(["cadian-shock-troops"], units, undefined)))
      .toEqual(["cadian-castellan", "commissar-yarrick", "lord-solar-leontus"]);
  });

  it("costs the supporting Officer that issues a selected Order no member can issue", () => {
    const cell = session("astra-militarum", "shooting");
    const titanic = spec("astra-militarum", "armoured-infantry", ["doomhammer"]);
    const takeAim = cell.pool(titanic).levers.filter((lever) => lever.source.kind === "ability" && lever.source.abilityId === voice);
    expect(takeAim.length).toBeGreaterThan(0);
    const support = new Map<string, Set<string>>();
    addOrderIssuers(dataset, resolveFactionContext(dataset, "astra-militarum"), cell, { spec: titanic } as never, takeAim, support);
    expect([...support.keys()]).toHaveLength(1);
    expect(["commissar-yarrick", "lord-solar-leontus"]).toContain([...support.keys()][0]);
    expect([...support.values()][0]).toEqual(new Set([voice]));

    const led = spec("astra-militarum", "armoured-infantry", ["cadian-shock-troops", "cadian-castellan"]);
    const ledOrders = cell.pool(led).levers.filter((lever) => lever.source.kind === "ability" && lever.source.abilityId === voice);
    const none = new Map<string, Set<string>>();
    addOrderIssuers(dataset, resolveFactionContext(dataset, "astra-militarum"), cell, { spec: led } as never, ledOrders, none);
    expect(none.size).toBe(0);
  });
});

describe("stack damage suppression", () => {
  it("drops an army rule the detachment rule suppresses for the unit", () => {
    const pacts = "dark-pacts-chaos-space-marines";
    expect(offered("chaos-space-marines", "renegade-warband", ["defiler"], "shooting").has(pacts)).toBe(false);
    expect(offered("chaos-space-marines", "renegade-raiders", ["defiler"], "shooting").has(pacts)).toBe(true);
  });

  it("drops it across detachment passes when another selected detachment suppresses it", () => {
    const pacts = "dark-pacts-chaos-space-marines";
    const both = spec("chaos-space-marines", "renegade-raiders", ["defiler"]);
    both.detachmentIds.push("renegade-warband");
    const levers = session("chaos-space-marines", "shooting").pool(both).levers;
    expect(levers.some((lever) => lever.source.kind === "ability" && lever.source.abilityId === pacts)).toBe(false);
  });
});

describe("stack damage triggered suppression", () => {
  it("leaves a suppression to play when the suppressing rule has a trigger", () => {
    // Renegade Warband's rule suppresses Dark Pacts as a standing rule. The same rule behind a
    // trigger only suppresses it once the trigger happens, so the pool keeps offering Dark Pacts.
    const pacts = "dark-pacts-chaos-space-marines";
    const triggered = new Dataset({
      ...RAW_DATA,
      abilities: RAW_DATA.abilities.map((a) => (a.ability_id === "slaves-to-none-chaos-space-marines" ? { ...a, trigger: { event: "round-started" } } : a)),
    } as typeof RAW_DATA);
    const config = parseMatrixConfig(
      { HC_FACTIONS: "chaos-space-marines", HC_TARGETS: TARGET, HC_PHASES: "shooting", HC_OUTPUT: "stack-damage.json" },
      { factionIds: new Set(["chaos-space-marines"]), targetIds: [TARGET] },
    );
    const target = resolveTarget(triggered, triggered.targetProfiles.get(TARGET)!)!;
    const pool = damageScoringSession({ dataset: triggered, config, faction: resolveFactionContext(triggered, "chaos-space-marines"), target, phase: "shooting" })
      .pool(emptySpec("chaos-space-marines", [{ unit: triggered.units.getInFaction("defiler", "chaos-space-marines")!, role: "bodyguard" }] as StackMember[], ["renegade-warband"]));
    expect(pool.levers.some((lever) => lever.source.kind === "ability" && lever.source.abilityId === pacts)).toBe(true);
  });
});

describe("stack damage eligibility disclosure", () => {
  it("lists the battlefield conditions a Stratagem's target is assumed to meet", () => {
    expect(assumedEligibility(dataset, "titanic-bombardment-gate-warden-lance-imperial-knights")).toEqual([
      'happened move-ended {"move_types":["remain-stationary"]}',
      'in-region {"subject":"this-unit","region":{"rule_region":{"region_id":"defensive-line","owner_faction":"imperial-knights"}}}',
    ]);
  });

  it("lists nothing for a Stratagem whose target is decided by keywords alone", () => {
    expect(assumedEligibility(dataset, "dispense-justice-ordo-hereticus-purgation-force-agents-of-the-imperium")).toEqual([]);
  });
});

describe("stack damage model-keyword gates on detachment rules", () => {
  it("offers Combat Drugs only to a unit with WYCH CULT models", () => {
    const drugs = "combat-drugs-drukhari";
    expect(offered("drukhari", "spectacle-of-spite", ["wyches"], "fight").has(drugs)).toBe(true);
    expect(offered("drukhari", "spectacle-of-spite", ["kabalite-warriors"], "fight").has(drugs)).toBe(false);
  });

  it("offers Experimental Augmentations only to HERETIC ASTARTES INFANTRY models", () => {
    const augmentations = "experimental-augmentations-chaos-space-marines";
    expect(offered("chaos-space-marines", "creations-of-bile", ["legionaries"], "fight").has(augmentations)).toBe(true);
    expect(offered("chaos-space-marines", "creations-of-bile", ["chaos-predator-annihilator"], "fight").has(augmentations)).toBe(false);
    expect(offered("chaos-space-marines", "creations-of-bile", ["helbrute"], "fight").has(augmentations)).toBe(false);
  });

  it("gives a Transport's own weapons no Firing Deck hit bonus", () => {
    expect(offered("orks", "wreckas", ["battlewagon"], "shooting").has("drive-by-bustin-wreckas-orks")).toBe(false);
  });
});
