/**
 * Round-trip property tests: for each of the four NewRecruit formats, the
 * pipeline `Roster → export → import → Roster'` must produce the same Roster
 * (a fixed point). Faction/detachment display names lose case nuance through
 * `titleCaseId` round-tripping, but the *resolved* `faction_id` /
 * `detachment_id` survive untouched — so we compare on IDs and unit data.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Dataset } from "../../src/data/dataset.js";
import { importRoster } from "../../src/import/import-roster.js";
import { exportRoster } from "../../src/export/index.js";
import type { ExportFormat, Roster } from "../../src/index.js";

const ds = Dataset.embedded();

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url)),
      "utf8",
    ),
  );

/** Strip fields that aren't expected to survive round-tripping: the
 * `source.format` discriminator naturally changes per hop, and the diagnostic
 * warning list shifts when the multi-force flag is inferred differently. */
function stable(r: Roster) {
  return {
    name: r.name,
    faction_id: r.faction_id,
    detachment_id: r.detachment_id,
    battle_size: r.battle_size,
    points: r.points,
    units: r.units,
    game_version: r.game_version,
  };
}

describe("export → import round-trips", () => {
  const seed = importRoster(
    fixture("chaos-knights-houndpack.newrecruit.payload.json"),
    { dataset: ds },
  );

  const formats: ExportFormat[] = [
    "newrecruit-json",
    "newrecruit-wtc-compact",
    "newrecruit-wtc-full",
    "newrecruit-simple",
    "roster-json",
  ];

  for (const format of formats) {
    it(`Roster → ${format} → Roster is a fixed point`, () => {
      const out = exportRoster(seed, format);
      expect(out.length).toBeGreaterThan(0);
      // Re-import: JSON formats parse through importRoster directly; text
      // formats too (the orchestrator dispatches on string vs. object).
      const reparsed = format === "newrecruit-json" || format === "roster-json"
        ? importRoster(JSON.parse(out), { dataset: ds })
        : importRoster(out, { dataset: ds });
      expect(stable(reparsed)).toEqual(stable(seed));
    });
  }

  it("never emits prose in any text format", () => {
    for (const format of formats) {
      const out = exportRoster(seed, format);
      expect(out).not.toMatch(/Aura\)\*\*/);
      expect(out).not.toMatch(/Each time an attack/);
      expect(out).not.toMatch(/\$text/);
    }
  });
});
