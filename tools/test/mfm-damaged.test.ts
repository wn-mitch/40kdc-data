import { readFileSync } from "node:fs";
import { glob } from "glob";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { readDamaged } from "../src/mfm/damaged.js";

const DATA = path.resolve(import.meta.dirname, "../../data");

// Clause fragments only (never a printed block): the reader keys on clauses, not wording.
describe("readDamaged", () => {
  it("reads a codex datasheet that only names the rule as core Damaged at its threshold", () => {
    expect(readDamaged("DAMAGED", "", 6)).toEqual({ kind: "core", threshold: 6 });
  });

  it("reads a printed bracket with a Hit penalty of 1 as core Damaged, whatever dash it prints", () => {
    expect(readDamaged("x", "While this model has 1-5 wounds remaining, subtract 1 from the Hit roll.", null)).toEqual({ kind: "core", threshold: 5 });
    expect(readDamaged("x", "While this model has 1‑5 wounds remaining, each time it makes an attack, subtract 1 from the Hit roll.", null)).toEqual({ kind: "core", threshold: 5 });
  });

  it("splits an Objective Control penalty off as its own rated rule", () => {
    expect(readDamaged("x", "While this model has 1-9 wounds remaining, subtract 5 from its Objective Control characteristic and subtract 1 from the Hit roll.", null))
      .toEqual({ kind: "core+oc", threshold: 9, oc: 5 });
  });

  it("keeps anything else as a rule of its own", () => {
    expect(readDamaged("x", "While this model has 1-6 wounds remaining, halve the Attacks characteristic.", null)).toEqual({ kind: "other" });
    expect(readDamaged("x", "While this model has 1-6 wounds remaining, subtract 2 from the Hit roll.", null)).toEqual({ kind: "other" });
    expect(readDamaged("x", "While this model has 1-6 wounds remaining, subtract 1 from the Hit roll and it cannot shoot twice.", null)).toEqual({ kind: "other" });
  });
});

describe("Damaged in the data", () => {
  it("rates core Damaged on each unit instead of keeping a per-faction copy of it", async () => {
    const records = (await glob("enrichment/*/abilities.json", { cwd: DATA, absolute: true })).flatMap(
      (f) => JSON.parse(readFileSync(f, "utf8")) as Array<{ ability_id: string }>,
    );
    // Only the rules that are not core Damaged restated keep a record of their own.
    expect(records.filter((r) => /^damaged-1-\d+-wounds-remaining/.test(r.ability_id)).length).toBeLessThanOrEqual(6);
    const castigator = (JSON.parse(readFileSync(path.join(DATA, "core/adepta-sororitas/units.json"), "utf8")) as Array<{ id: string; ability_ids: unknown[] }>)
      .find((u) => u.id === "castigator")!;
    expect(castigator.ability_ids).toContainEqual({ id: "damaged", value: 4 });
  });
});
