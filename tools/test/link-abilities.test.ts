import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkAbilities } from "../src/link-abilities.js";

function setupRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "link-abilities-"));
  for (const sub of [
    "data/core/alpha",
    "data/core/beta",
    "data/core/_example",
    "data/enrichment/alpha",
    "data/enrichment/beta",
    "data/enrichment/gamma-subfaction",
  ]) {
    mkdirSync(join(root, sub), { recursive: true });
  }
  return root;
}

function write(root: string, rel: string, data: unknown) {
  writeFileSync(join(root, rel), JSON.stringify(data, null, 2) + "\n");
}

function read<T>(root: string, rel: string): T {
  return JSON.parse(readFileSync(join(root, rel), "utf-8")) as T;
}

describe("linkAbilities", () => {
  let root: string;

  beforeEach(() => {
    root = setupRepo();
    write(root, "data/core/alpha/units.json", [
      { id: "alpha-hero", ability_ids: ["manual-only"] },
      { id: "alpha-squad", ability_ids: [] },
    ]);
    write(root, "data/core/beta/units.json", [
      { id: "beta-monster", ability_ids: [] },
    ]);
    write(root, "data/enrichment/alpha/abilities.json", [
      { ability_id: "rage", unit_ids: ["alpha-hero", "alpha-squad"] },
      { ability_id: "stealth", unit_ids: [] },
    ]);
    write(root, "data/enrichment/beta/abilities.json", [
      { ability_id: "fury", unit_ids: ["beta-monster"] },
    ]);
    // A subfaction enrichment file whose unit_ids reference an alpha unit.
    write(root, "data/enrichment/gamma-subfaction/abilities.json", [
      { ability_id: "gamma-bonus", unit_ids: ["alpha-hero", "ghost-unit"] },
    ]);
    write(root, "data/core/alpha/leader-attachments.json", [
      { leader_id: "alpha-hero" },
    ]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("merges enrichment unit_ids into core ability_ids without dropping existing entries", () => {
    const summary = linkAbilities({ rootDir: root });

    const alpha = read<{ id: string; ability_ids: string[] }[]>(root, "data/core/alpha/units.json");
    const hero = alpha.find((u) => u.id === "alpha-hero")!;
    expect(hero.ability_ids).toEqual(["gamma-bonus", "leader", "manual-only", "rage"]);

    const squad = alpha.find((u) => u.id === "alpha-squad")!;
    expect(squad.ability_ids).toEqual(["rage"]);

    expect(summary.unitsChanged).toBe(3);
  });

  it("routes cross-faction enrichment files to the owning core file (first-match-wins)", () => {
    linkAbilities({ rootDir: root });
    const alpha = read<{ id: string; ability_ids: string[] }[]>(root, "data/core/alpha/units.json");
    const hero = alpha.find((u) => u.id === "alpha-hero")!;
    expect(hero.ability_ids).toContain("gamma-bonus");
  });

  it("layers in leader-attachments.json leader_ids as the 'leader' ability", () => {
    linkAbilities({ rootDir: root });
    const alpha = read<{ id: string; ability_ids: string[] }[]>(root, "data/core/alpha/units.json");
    expect(alpha.find((u) => u.id === "alpha-hero")!.ability_ids).toContain("leader");
  });

  it("surfaces unit_ids that no core file claims (authoring drift)", () => {
    const summary = linkAbilities({ rootDir: root });
    expect(summary.unknownUnitIdReferences).toContain("ghost-unit");
    expect(summary.unknownUnitIdReferences).not.toContain("alpha-hero");
  });

  it("is idempotent: a second run after a clean run reports zero changes", () => {
    linkAbilities({ rootDir: root });
    const summary = linkAbilities({ rootDir: root });
    expect(summary.unitsChanged).toBe(0);
    expect(summary.abilityLinksAdded).toBe(0);
    expect(summary.filesWritten).toEqual([]);
  });

  it("does not write when --dry-run", () => {
    const summary = linkAbilities({ rootDir: root, dryRun: true });
    expect(summary.unitsChanged).toBeGreaterThan(0);
    expect(summary.filesWritten).toEqual([]);
    const alpha = read<{ id: string; ability_ids: string[] }[]>(root, "data/core/alpha/units.json");
    expect(alpha.find((u) => u.id === "alpha-hero")!.ability_ids).toEqual(["manual-only"]);
  });

  it("respects --faction filter (only processes that faction's units.json)", () => {
    linkAbilities({ rootDir: root, factionFilter: "beta" });
    const alpha = read<{ id: string; ability_ids: string[] }[]>(root, "data/core/alpha/units.json");
    const beta = read<{ id: string; ability_ids: string[] }[]>(root, "data/core/beta/units.json");
    expect(alpha.find((u) => u.id === "alpha-hero")!.ability_ids).toEqual(["manual-only"]);
    expect(beta.find((u) => u.id === "beta-monster")!.ability_ids).toEqual(["fury"]);
  });
});
