import { describe, expect, it } from "vitest";
import { Dataset, type Buff } from "@alpaca-software/40kdc-data";

import {
  activeSupport,
  defenderBuffs,
  defenderDetachments,
  defenderEnhancements,
  defenderStratagems,
  supportProviders,
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
