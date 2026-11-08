import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAbilityEntity, resolveCheckedEntity } from "../src/semantic-authoring/entries.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A data root with a parent faction holding one shared rule and a child faction holding none. */
function dataRoot(childFaction: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "semantic-authoring-checked-"));
  roots.push(root);
  for (const faction of ["alpha-legion", "beta-chapter"]) mkdirSync(join(root, "enrichment", faction), { recursive: true });
  writeFileSync(join(root, "enrichment", "alpha-legion", "abilities.json"), JSON.stringify([{ ability_id: "shared-rule-alpha-legion", name: "Shared Rule" }]));
  writeFileSync(join(root, "enrichment", "beta-chapter", "abilities.json"), JSON.stringify([{ ability_id: "own-rule", name: "Own Rule" }]));
  mkdirSync(join(root, "core", "beta-chapter"), { recursive: true });
  writeFileSync(join(root, "core", "beta-chapter", "factions.json"), JSON.stringify([childFaction]));
  return root;
}

describe("Semantic authoring checked entity", () => {
  it("checks a chapter's copy of a shared rule against its parent's entry", () => {
    const root = dataRoot({ id: "beta-chapter", parent_faction_id: "alpha-legion" });
    const resolved = resolveCheckedEntity(root, "beta-chapter", "shared-rule-alpha-legion");
    expect(resolved.entry.name).toBe("Shared Rule");
    expect(resolved.file).toBe(join(realpathSync(root), "enrichment", "alpha-legion", "abilities.json"));
  });

  it("prefers the faction's own entry over the parent's", () => {
    const root = dataRoot({ id: "beta-chapter", parent_faction_id: "alpha-legion" });
    expect(resolveCheckedEntity(root, "beta-chapter", "own-rule").entry.name).toBe("Own Rule");
  });

  it("still refuses a missing entry when the faction has no parent", () => {
    const root = dataRoot({ id: "beta-chapter" });
    expect(() => resolveCheckedEntity(root, "beta-chapter", "shared-rule-alpha-legion")).toThrow(/beta-chapter\/shared-rule-alpha-legion is missing/u);
  });

  it("leaves the publication resolver strict per faction", () => {
    const root = dataRoot({ id: "beta-chapter", parent_faction_id: "alpha-legion" });
    expect(() => resolveAbilityEntity(root, "beta-chapter", "shared-rule-alpha-legion")).toThrow(/is missing/u);
  });
});
