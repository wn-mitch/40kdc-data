import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { Dataset } from "../src/data/dataset.js";
import { createRunnerState, dispatch } from "../src/runner.js";
import { resolveFactionContext } from "../src/stack-damage/factions.js";

// The embedded dataset is the matched-play view: its listings skip Combat
// Patrol-only records, while id lookups resolve them in every view.

const ds = Dataset.embedded();
const cp = ds.forGameMode("combat-patrol");
const all = ds.forGameMode("all");

const ADMECH = "adeptus-mechanicus";
const SKAND = "manipulus-skand";
const PURGE_CORPS = "purge-corps-deltic-9";
const ENHANCEMENT = "empowered-mechanisms-purge-corps-deltic-9-adeptus-mechanicus";

const ids = (records: Iterable<{ id: string }>) => [...records].map((r) => r.id);

describe("default (matched-play) view", () => {
  it("is the embedded dataset's mode", () => {
    expect(ds.gameMode).toBe("matched-play");
    expect(new Dataset().gameMode).toBe("matched-play");
  });

  it("omits a Combat Patrol unit from every unit listing", () => {
    expect(ids(ds.units.byFaction(ADMECH))).not.toContain(SKAND);
    expect(ids(ds.units)).not.toContain(SKAND);
    expect(ids(ds.units.all)).not.toContain(SKAND);
    expect(ds.units.find("Manipulus Skand")).toBeUndefined();
    // The exact-id step of a name search lists too.
    expect(ds.units.find(SKAND)).toBeUndefined();
    expect(ids(ds.factions.get(ADMECH)!.units)).not.toContain(SKAND);
    expect(ds.units.size).toBe(ds.units.all.length);
    expect(ds.units.size).toBeLessThan(all.units.size);
  });

  it("still resolves a Combat Patrol unit by id", () => {
    expect(ds.units.getAny(SKAND)?.id).toBe(SKAND);
    expect(ds.units.getInFaction(SKAND, ADMECH)?.id).toBe(SKAND);
    expect(ds.units.has(SKAND)).toBe(true);
  });

  it("treats detachments and enhancements the same way", () => {
    expect(ids(ds.detachments.byFaction(ADMECH))).not.toContain(PURGE_CORPS);
    expect(ds.detachments.find("Purge Corps Deltic-9")).toBeUndefined();
    expect(ds.detachments.getInFaction(PURGE_CORPS, ADMECH)?.id).toBe(PURGE_CORPS);
    expect(ids(ds.enhancements)).not.toContain(ENHANCEMENT);
    expect(ds.enhancements.find("Empowered Mechanisms")).toBeUndefined();
    expect(ds.enhancements.get(ENHANCEMENT)?.id).toBe(ENHANCEMENT);
  });

  it("filters reverse listings and the composition array, not per-unit lookups", () => {
    const skand = ds.units.getAny(SKAND)!;
    expect(ids(ds.unitsWithKeyword("Purge Corps Deltic-9"))).toEqual([]);
    expect(ids(all.unitsWithKeyword("Purge Corps Deltic-9"))).toContain(SKAND);
    const dgCp = "sholgor-the-putrid";
    expect(ds.unitCompositions.some((c) => c.unit_id === dgCp)).toBe(false);
    expect(all.unitCompositions.some((c) => c.unit_id === dgCp)).toBe(true);
    const sholgor = ds.units.getInFaction(dgCp, "death-guard")!;
    expect(ds.unitCompositionOf(sholgor.raw)?.unit_id).toBe(dgCp);
    expect(skand.weapons.length).toBeGreaterThan(0);
  });

  it("keeps Combat Patrol units out of the stack-damage faction context", () => {
    expect(ids(resolveFactionContext(ds, ADMECH).units)).not.toContain(SKAND);
    expect(ids(resolveFactionContext(cp, ADMECH).units)).toContain(SKAND);
  });
});

describe("forGameMode", () => {
  it("lists only the mode's records in the combat-patrol view", () => {
    expect(ids(cp.units.byFaction(ADMECH)).sort()).toEqual([
      SKAND,
      "purge-corps-pteraxii-sterylizors",
      "purge-corps-serberys-sulphurhounds",
      "purge-corps-skitarii-vanguard",
    ]);
    expect(cp.units.find("Manipulus Skand")?.id).toBe(SKAND);
    expect(ids(cp.detachments.byFaction(ADMECH))).toEqual([PURGE_CORPS]);
    expect(cp.enhancements.find("Empowered Mechanisms")?.id).toBe(ENHANCEMENT);
  });

  it("lists every record under all, the union of the modes", () => {
    const union = new Set([...ids(ds.units.byFaction(ADMECH)), ...ids(cp.units.byFaction(ADMECH))]);
    expect(new Set(ids(all.units.byFaction(ADMECH)))).toEqual(union);
    expect(all.units.size).toBe(ds.units.size + cp.units.size);
  });

  it("caches views and links records back into their own view", () => {
    expect(ds.forGameMode("combat-patrol")).toBe(cp);
    expect(cp.forGameMode("matched-play")).toBe(ds);
    const skand = cp.units.getAny(SKAND)!;
    expect(ids(skand.faction!.units)).toContain(SKAND);
    expect(ids(ds.units.getAny(SKAND)!.faction!.units)).not.toContain(SKAND);
  });

  it("leaves unscoped collections whole", () => {
    expect(cp.factions.size).toBe(ds.factions.size);
    expect(cp.abilities.size).toBe(ds.abilities.size);
  });

  it("rejects an unknown mode", () => {
    expect(() => ds.forGameMode("skirmish" as never)).toThrow(/Unknown game mode/);
  });
});

describe("linked_query gameMode", () => {
  const state = createRunnerState();
  const specVersion = Number(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../conformance/SPEC_VERSION"), "utf8").trim(),
  );
  const init = dispatch(state, {
    op: "init",
    args: { spec_version: specVersion, locale: "C", tz: "UTC", seed: 0 },
  });

  it("initializes", () => expect(init.ok, JSON.stringify(init)).toBe(true));
  const query = (query: string, input: Record<string, string>) =>
    dispatch(state, { op: "linked_query", args: { query, input } } as never) as {
      ok: boolean;
      value?: unknown;
      error_kind?: string;
    };

  it("runs listings against the requested view", () => {
    expect(query("units_of_faction", { factionId: ADMECH }).value).not.toContain(SKAND);
    expect(query("units_of_faction", { factionId: ADMECH, gameMode: "combat-patrol" }).value).toContain(SKAND);
    expect(query("get_unit", { unitId: SKAND }).value).toBe(SKAND);
  });

  it("answers INVALID_INPUT for an unknown mode", () => {
    expect(query("units_of_faction", { factionId: ADMECH, gameMode: "skirmish" }).error_kind).toBe("INVALID_INPUT");
  });
});
