/**
 * Keystone pairing invariant over the shipped layout data: every authored
 * measurement keystone has its point-reflected mirror on the piece's
 * 180°-symmetry twin, so layout cards print dimension lines for both
 * players' halves. The layout editor maintains this on add/remove;
 * `src/migrate-keystone-twins.ts` back-fills (and `--check` re-audits) it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { pairKeystones } from "../src/migrate-keystone-twins.js";
import type { TerrainLayout, TerrainTemplate } from "../src/terrain/resolve.js";

const REPO_ROOT = join(new URL("../..", import.meta.url).pathname);
const read = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(REPO_ROOT, "data", "core", rel), "utf8")) as T;

describe("keystone twin pairing (shipped data)", () => {
  const layouts = read<TerrainLayout[]>("terrain-layouts.json");
  const templates = read<TerrainTemplate[]>("terrain-templates.json");

  it("every keystone has its mirror on the symmetry twin", () => {
    const report = pairKeystones(layouts, templates, false);
    expect(
      report.additions.map((a) => `${a.layoutId}/${a.fromPieceId} -> ${a.pieceId}`),
    ).toEqual([]);
  });

  it("no keystone-bearing piece is unpairable", () => {
    // A warning means a piece the mirroring can't handle mechanically
    // (no twin, parented feature, asymmetric vertex) — those need a
    // hand-authored counterpart, not silence.
    const report = pairKeystones(layouts, templates, false);
    expect(report.warnings).toEqual([]);
  });
});
