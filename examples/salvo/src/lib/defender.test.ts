import { describe, expect, it } from "vitest";
import { Dataset, type Buff, type Roster } from "@alpaca-software/40kdc-data";
import { readFileSync } from "node:fs";

import {
  activeSupport,
  defenderBuffs,
  defenderDetachments,
  defenderEnhancements,
  defenderLevers,
  defenderNeeds,
  defenderStratagems,
  leaderOwnDefences,
  rosterDefenderBuild,
  supportProviders,
  targetWargearChoices,
} from "./defender.js";

const ds = Dataset.embedded();
const context = { phase: "shooting" as const };
const none = { detachmentId: null, stratagemIds: [], enhancementId: null };
const types = (buffs: Buff[]) => buffs.map((buff) => buff.contribution.type);

describe("defender build", () => {
  const telemon = ds.units.getInFaction("telemon-heavy-dreadnought", "adeptus-custodes")!;
  const strat = "shield-of-faith-army-of-faith-adepta-sororitas";

  it("applies an opted-in Stratagem only", () => {
    const sisters = ds.units.getInFaction("battle-sisters-squad", "adepta-sororitas")!;
    expect(defenderStratagems(ds, sisters, "army-of-faith", "shooting").map((s) => s.id)).toContain(strat);
    const build = { ...none, detachmentId: "army-of-faith" };
    expect(types(defenderBuffs(ds, sisters, build, context))).not.toContain("feel-no-pain");
    expect(types(defenderBuffs(ds, sisters, { ...build, stratagemIds: [strat] }, context))).toContain("feel-no-pain");
  });

  it("ignores another faction's detachment", () => {
    expect(defenderDetachments(ds, "adeptus-custodes").map((d) => d.id)).not.toContain("gladius-task-force");
    const foreign = defenderBuffs(ds, telemon, { ...none, detachmentId: "gladius-task-force" }, context);
    expect(types(foreign)).toEqual(types(defenderBuffs(ds, telemon, none, context)));
  });

  it("applies the Enhancement only to a unit that can take it", () => {
    const enhancement = "artificer-armour-gladius-task-force-adeptus-astartes";
    const build = { ...none, detachmentId: "gladius-task-force", enhancementId: enhancement };
    const marshal = ds.units.getInFaction("marshal", "adeptus-astartes")!;
    expect(defenderEnhancements(ds, marshal, "gladius-task-force").map((e) => e.id)).toContain(enhancement);
    expect(types(defenderBuffs(ds, marshal, build, context))).toContain("feel-no-pain");

    const squad = ds.units.getInFaction("intercessor-squad", "adeptus-astartes")!;
    expect(defenderEnhancements(ds, squad, "gladius-task-force")).toEqual([]);
    expect(types(defenderBuffs(ds, squad, build, context)))
      .toEqual(types(defenderBuffs(ds, squad, { ...build, enhancementId: null }, context)));
  });

  it("gives the target the rules of a leader that reach its unit", () => {
    const squad = ds.units.getInFaction("intercessor-squad", "adeptus-astartes")!;
    expect(types(defenderBuffs(ds, squad, none, context))).not.toContain("feel-no-pain");
    const fnp = defenderBuffs(ds, squad, { ...none, attachedUnitIds: ["captain-titus"] }, context)
      .filter((buff) => buff.contribution.type === "feel-no-pain");
    expect(fnp.map((buff) => buff.contribution)).toEqual([{ type: "feel-no-pain", threshold: 5 }]);
    const invuln = defenderBuffs(ds, squad, { ...none, attachedUnitIds: ["azrael"] }, context)
      .filter((buff) => buff.contribution.type === "invulnerable-save");
    expect(invuln.map((buff) => buff.contribution)).toEqual([{ type: "invulnerable-save", threshold: 4 }]);
  });

  it("keeps a leader's personal defences on its own model", () => {
    const squad = ds.units.getInFaction("intercessor-squad", "adeptus-astartes")!;
    const lieutenant = ds.units.getInFaction("lieutenant", "adeptus-astartes")!;
    expect(leaderOwnDefences(ds, squad, lieutenant, none, context).map((buff) => buff.contribution))
      .toEqual([{ type: "invulnerable-save", threshold: 4 }]);
    expect(types(defenderBuffs(ds, squad, { ...none, attachedUnitIds: [lieutenant.id] }, context))).not.toContain("invulnerable-save");
  });
});

describe("support providers", () => {
  it("lists units whose abilities reach others, excluding the combined unit", () => {
    const providers = supportProviders(ds, "adeptus-custodes", []);
    expect(providers.length).toBeGreaterThan(0);
    const first = providers[0];
    expect(supportProviders(ds, "adeptus-custodes", [first.id]).map((u) => u.id)).not.toContain(first.id);
  });

  it("drops a chosen unit that no longer provides", () => {
    const first = supportProviders(ds, "adeptus-custodes", [])[0];
    expect(activeSupport(ds, "adeptus-custodes", [], [first.id, "intercessor-squad"])).toEqual([first.id]);
    expect(activeSupport(ds, "adeptus-custodes", [first.id], [first.id])).toEqual([]);
    expect(activeSupport(ds, null, [], [first.id])).toEqual([]);
  });

  it("adds the chosen provider's levers to the attacker", () => {
    const input = { unitId: "krootox-rampagers", factionId: "tau-empire" };
    const chosen = activeSupport(ds, "tau-empire", ["krootox-rampagers"], ["commander-shadowsun"]);
    expect(chosen).toEqual(["commander-shadowsun"]);
    const before = new Set(ds.stackableBuffsFor(input, context).buffs.map((lever) => lever.id));
    const added = ds.stackableBuffsFor({ ...input, supportingUnitIds: chosen }, context).buffs.filter((lever) => !before.has(lever.id));
    // Another unit's ability reaches this one only where the player places it, so it starts off.
    expect(added.map((lever) => lever.enabled)).toEqual([false]);
  });
});

describe("the target's wargear", () => {
  const strikeTeam = ds.units.getInFaction("strike-team", "tau-empire")!;
  const fromAbility = (buffs: Buff[], abilityId: string) =>
    buffs.filter((buff) => buff.source.kind === "ability" && buff.source.abilityId === abilityId).map((buff) => buff.contribution);

  it("offers the drones the target can take", () => {
    expect(targetWargearChoices(ds, strikeTeam).map((item) => item.id)).toEqual(expect.arrayContaining(["guardian-drone", "shield-drone"]));
  });

  it("applies the Guardian Drone's Wound roll penalty only while the target carries one", () => {
    const guarded = defenderBuffs(ds, strikeTeam, { ...none, wargear: { "guardian-drone": 1 } }, context);
    expect(fromAbility(guarded, "drones-tau-empire")).toEqual([{ type: "wound-mod", value: -1 }]);
    // The out-of-the-box Strike Team carries no drone: neither the army rule nor the drone's own rule applies.
    for (const build of [none, { ...none, wargear: {} }]) {
      const bare = defenderBuffs(ds, strikeTeam, build, context);
      expect(fromAbility(bare, "drones-tau-empire")).toEqual([]);
      expect(fromAbility(bare, "guardian-drone-tau-empire")).toEqual([]);
    }
  });

  it("gives a bearer's own wargear rule to the target only while every model carries the item", () => {
    const terminators = ds.units.getAny("wolf-guard-terminators")!;
    const shield = "storm-shield-wolf-guard-battle-leader-space-wolves";
    const shields = (count: number) => defenderBuffs(ds, terminators, { ...none, wargear: { "storm-shield": count }, modelCount: 5 }, context);
    expect(fromAbility(shields(5), shield)).toEqual([{ type: "wounds-mod", value: 1 }]);
    expect(fromAbility(shields(2), shield)).toEqual([]);
  });
});

describe("the target's optional abilities", () => {
  // Psychic Barrier: an optional roll whose 2-6 result gives the Psyker a 4+ invulnerable save.
  const psyker = ds.units.getInFaction("primaris-psyker", "astra-militarum")!;
  const barrier = "psychic-barrier-astra-militarum@phase-started";
  const rolled = (holds: boolean) => {
    const need = defenderNeeds(ds, psyker, none, context).find((item) => item.abilityId === "psychic-barrier-astra-militarum")!;
    return { ...context, conditionFacts: { [need.key]: holds } };
  };
  const invulns = (buffs: Buff[]) => buffs.filter((buff) => buff.contribution.type === "invulnerable-save").map((buff) => buff.contribution);

  it("offers the ability once its roll is answered true", () => {
    expect(defenderLevers(ds, psyker, none, context).buffs.map((lever) => lever.id)).not.toContain(barrier);
    expect(defenderLevers(ds, psyker, none, rolled(false)).buffs.map((lever) => lever.id)).not.toContain(barrier);
    expect(defenderLevers(ds, psyker, none, rolled(true)).buffs.map((lever) => lever.id)).toContain(barrier);
  });

  it("gives the target the invulnerable save only while toggled on", () => {
    const off = defenderBuffs(ds, psyker, none, rolled(true));
    const on = defenderBuffs(ds, psyker, { ...none, leverOverrides: { [barrier]: true } }, rolled(true));
    expect(invulns(off)).toEqual([]);
    expect(invulns(on)).toEqual([{ type: "invulnerable-save", threshold: 4 }]);
  });

  it("ignores a toggled ability no longer offered", () => {
    // The roll answered false withdraws the lever, so its save does not apply.
    expect(invulns(defenderBuffs(ds, psyker, { ...none, leverOverrides: { [barrier]: true } }, rolled(false)))).toEqual([]);
  });

  it("applies an opted-in Stratagem's optional buff with no further click, until unticked", () => {
    const mortifiers = ds.units.getInFaction("mortifiers", "adepta-sororitas")!;
    const strat = "purity-of-suffering-penitent-host-adepta-sororitas";
    const build = { ...none, detachmentId: "penitent-host" };
    const levers = (stratagemIds: string[]) => defenderLevers(ds, mortifiers, { ...build, stratagemIds }, context).buffs;
    expect(levers([]).some((lever) => lever.id.startsWith(strat))).toBe(false);
    const lever = levers([strat]).find((item) => item.id.startsWith(strat))!;
    // Listed, and on by default: opting into the Stratagem declares its use.
    expect(lever.enabled).toBe(true);
    const fnp = (leverOverrides: Record<string, boolean>) =>
      defenderBuffs(ds, mortifiers, { ...build, stratagemIds: [strat], leverOverrides }, context)
        .filter((buff) => buff.source.kind === "ability" && buff.source.abilityId === strat)
        .map((buff) => buff.contribution);
    expect(fnp({})).toEqual([{ type: "feel-no-pain", threshold: 4 }]);
    expect(fnp({ [lever.id]: false })).toEqual([]);
  });

  it("keeps a unit's own optional ability off until ticked", () => {
    expect(defenderLevers(ds, psyker, none, rolled(true)).buffs.find((lever) => lever.id === barrier)?.enabled).toBe(false);
  });
});

describe("the leader's Enhancement", () => {
  const unit = (id: string) => ds.units.getInFaction(id, "adeptus-astartes")!;
  const contributions = (buffs: Buff[]) => buffs.map((buff) => buff.contribution);

  it("gives the attached unit the effects it has on the unit", () => {
    const build = { ...none, detachmentId: "gravis-linebreaker-force", attachedUnitIds: ["captain-in-gravis-armour"] };
    const enhancement = "indefatigable-fortitude-gravis-linebreaker-force-adeptus-astartes";
    expect(contributions(defenderBuffs(ds, unit("indomitor-kill-team"), build, context))).not.toContainEqual({ type: "wound-mod", value: -1 });
    expect(contributions(defenderBuffs(ds, unit("indomitor-kill-team"), { ...build, leaderEnhancementId: enhancement }, context)))
      .toContainEqual({ type: "wound-mod", value: -1 });
  });

  it("keeps the effects on the bearer on the leader's model", () => {
    const build = { ...none, detachmentId: "gladius-task-force", attachedUnitIds: ["captain"], leaderEnhancementId: "artificer-armour-gladius-task-force-adeptus-astartes" };
    const squad = unit("sword-brethren-squad");
    expect(contributions(leaderOwnDefences(ds, squad, unit("captain"), build, context)))
      .toEqual(expect.arrayContaining([{ type: "save-characteristic", value: 2 }, { type: "feel-no-pain", threshold: 5 }]));
    expect(types(defenderBuffs(ds, squad, build, context))).not.toContain("feel-no-pain");
  });
});

describe("the leader's Enhancement's optional abilities", () => {
  it("offers them as levers whose unit-wide effects reach the unit when on", () => {
    const squad = ds.units.getInFaction("celestian-sacresants", "adepta-sororitas")!;
    const build = { ...none, detachmentId: "sanctified-orators", attachedUnitIds: ["canoness"], leaderEnhancementId: "hagiomnifex-upgrade-sanctified-orators-adepta-sororitas" };
    const lever = defenderLevers(ds, squad, build, context).buffs.find((l) => l.id.startsWith("leader:") && l.buffs.some((b) => b.contribution.type === "wound-mod"))!;
    expect(lever.enabled).toBe(false);
    expect(types(defenderBuffs(ds, squad, build, context))).not.toContain("wound-mod");
    expect(types(defenderBuffs(ds, squad, { ...build, leverOverrides: { [lever.id]: true } }, context))).toContain("wound-mod");
  });

  it("gives the bearer the effects on its own model when on", () => {
    const squad = ds.units.getInFaction("custodian-guard-sodality", "adeptus-custodes")!;
    const captain = ds.units.getInFaction("shield-captain", "adeptus-custodes")!;
    const build = { ...none, detachmentId: "guardians-of-the-throne", attachedUnitIds: [captain.id], leaderEnhancementId: "eagles-eye-guardians-of-the-throne-adeptus-custodes" };
    const lever = defenderLevers(ds, squad, build, context).buffs.find((l) => l.id.startsWith("leader:"))!;
    const on = { ...build, leverOverrides: { [lever.id]: true } };
    const invuln = (buffs: Buff[]) => buffs.filter((b) => b.contribution.type === "invulnerable-save").map((b) => b.contribution);
    expect(invuln(leaderOwnDefences(ds, squad, captain, build, context))).toEqual([]);
    expect(invuln(leaderOwnDefences(ds, squad, captain, on, context))).toEqual([{ type: "invulnerable-save", threshold: 3 }]);
    expect(invuln(defenderBuffs(ds, squad, on, context))).toEqual([]);
  });
});

describe("an imported target's build", () => {
  const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../../conformance/roster/${name}/expected.roster.json`, import.meta.url), "utf8")) as Roster;

  it("takes the detachment that offers the unit's Enhancement from a list of several", () => {
    const roster = load("custodes-nr-app-reference-entry");
    expect(roster.detachments.map((d) => d.ref.id)).toEqual(["emissaries-imperatus", "honoured-companions", "might-of-the-moritoi"]);
    const entry = roster.units.find((unit) => unit.ref.id === "telemon-heavy-dreadnought")!;
    const build = rosterDefenderBuild(ds, roster, entry, ds.units.getInFaction("telemon-heavy-dreadnought", "adeptus-custodes")!);
    expect(build.detachmentId).toBe("might-of-the-moritoi");
    expect(build.enhancementId).toBe("augury-uplink-one-per-army-upgrade-might-of-the-moritoi-adeptus-custodes");
  });

  it("takes the wargear records a unit lists, and its default loadout when it lists none", () => {
    const roster = load("sororitas-combat-patrol");
    const squad = roster.units.find((unit) => unit.ref.id === "sanctuary-guardians-battle-sisters-squad")!;
    const build = rosterDefenderBuild(ds, roster, squad, ds.units.getAny(squad.ref.id!)!);
    expect(build.detachmentId).toBe("sanctuary-guardians");
    expect(build.wargear?.["simulacrum-imperialis"]).toBe(1);
    const canoness = roster.units.find((unit) => unit.ref.id === "sanctuary-canoness-adalya")!;
    expect(rosterDefenderBuild(ds, roster, canoness, ds.units.getAny(canoness.ref.id!)!).wargear).toBeNull();
  });
});
