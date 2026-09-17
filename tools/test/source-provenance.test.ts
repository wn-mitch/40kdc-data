import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  auditSourceProvenance,
  normalizeForCompare,
  simulatePreFixResolution,
} from "../src/audit-source-provenance.js";
import { buildCohortStates, DEFAULT_CORPUS } from "../src/jev-orks-experiment.js";
import { DEFAULT_DUMP_PATH } from "../src/mfm/loader.js";

/**
 * The harness resolves a rule's operative text by NAME against the MFM dump,
 * and ability names collide across factions and detachments ("Full Throttle" is
 * both an Ork and an Adeptus Astartes stratagem). Before faction and
 * ability-type scoping, seven Ork abilities resolved to the wrong rule text,
 * three of them to another faction's rule entirely — and every downstream
 * claim about those abilities rested on it.
 *
 * These assertions pin the invariant rather than the implementation. Both
 * inputs are private exports absent from a fresh clone, so the suite skips
 * rather than failing there.
 */
describe.skipIf(!existsSync(DEFAULT_DUMP_PATH) || !existsSync(DEFAULT_CORPUS))("source provenance", () => {
  it("reproduces the pre-fix defect, so the guard is load-bearing", () => {
    // Reconstructed pre-fix resolution: first name match wins, no faction,
    // no ability-type gate. If this ever reports zero, the assertions below
    // have stopped testing anything.
    const simulation = simulatePreFixResolution();
    expect(simulation.summary.cross_faction).toBeGreaterThan(0);
    expect(simulation.summary.pre_fix_misresolved).toBeGreaterThan(0);
  });

  it("never feeds an Ork ability another faction's rule text", () => {
    const report = auditSourceProvenance();
    expect(report.summary.divergent_foreign_faction).toBe(0);
  });

  it("resolves colliding names to the Ork rule, not the Adeptus Astartes one", () => {
    const states = buildCohortStates({
      abilityIds: ["full-throttle", "gun-crazy-show-offs", "breakin-heads"],
    });
    // "Full Throttle" exists for Adeptus Astartes as "One ADEPTUS ASTARTES
    // MOUNTED or ADEPTUS ASTARTES VEHICLE unit...", which is what an unscoped
    // name match returned.
    expect(states["full-throttle"].source_text).not.toMatch(/ADEPTUS ASTARTES/i);
    expect(states["full-throttle"].source_text).toMatch(/Throttlerokkit Shokka Engine/i);
    // A datasheet rule sharing a stratagem's name must not borrow its text.
    expect(states["breakin-heads"].source_text).not.toMatch(/target that unit with this stratagem/i);
    expect(normalizeForCompare(states["gun-crazy-show-offs"].source_text)).toMatch(/snazzgun/);
  });
});
