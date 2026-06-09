/**
 * Canonical roster-json adapter: re-import a 40kdc {@link Roster} export.
 *
 * The exporter's `roster-json` format (see `export/roster-json.ts`) is the
 * lossless pivot — exactly `roster.schema.json` shape. This adapter closes the
 * loop so a 40kdc-native export round-trips through the normal
 * `tryImportRoster` pipeline: validate the canonical envelope, lower it to the
 * format-agnostic {@link ParsedRoster}, and let `resolve` re-derive ids
 * against the *current* dataset (so a stored export keeps resolving across
 * dataset releases, and stale ids self-heal through name resolution).
 *
 * Lowering notes:
 * - Unit/wargear/enhancement rows lower to their `ref.raw_name` — the same
 *   raw-display-name path every other adapter takes.
 * - `faction_id` has no raw name in the canonical shape, so the id slug is
 *   passed through as the raw name; collection lookup does an exact-id match
 *   before any name lookup, so resolution is exact. Detachments do carry a
 *   `ref.raw_name`, so (like units/enhancements) that lowers directly and
 *   round-trips the display name.
 * - `is_character` isn't stored on the canonical shape (it's an inference
 *   input, not an output). It lowers as `leader_attachment != null`, which
 *   reproduces the original (deterministic) attachment inference on
 *   re-import. Attachments are always provisional either way.
 *
 * **IP safety**: the canonical document carries only permitted facts (names,
 * counts, points, ids); no prose fields exist to read.
 *
 * TS mirror of `crates/wh40kdc/src/import/roster_json.rs`.
 */

import type { FormatAdapter } from "./adapter.js";
import type { ParsedRoster, ParsedUnit, Roster } from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Battle-size labels `resolve` maps back to the enum. */
const BATTLE_SIZE_LABELS: Record<string, string> = {
  incursion: "Incursion",
  "strike-force": "Strike Force",
};

export const rosterJsonAdapter: FormatAdapter = {
  id: "roster-json",

  /**
   * The canonical shape is unmistakable: a `source.format` discriminator plus
   * the `game_version` + `diagnostics` envelope no external builder emits.
   * All three are required by `roster.schema.json`.
   */
  matches(decoded: unknown): boolean {
    if (!isRecord(decoded)) return false;
    const source = decoded["source"];
    const gameVersion = decoded["game_version"];
    return (
      isRecord(source) &&
      typeof source["format"] === "string" &&
      isRecord(gameVersion) &&
      typeof gameVersion["edition"] === "string" &&
      isRecord(decoded["diagnostics"]) &&
      Array.isArray(decoded["units"])
    );
  },

  parse(decoded: unknown): ParsedRoster {
    // matches() vetted the envelope; the unit rows are schema-shaped.
    const roster = decoded as unknown as Roster;

    const units: ParsedUnit[] = roster.units.map((u) => ({
      raw_name: u.ref.raw_name,
      // Not stored canonically; attached units were characters, and re-running
      // the (deterministic) inference over them reproduces the exported
      // attachments. See module docs.
      is_character: u.leader_attachment != null,
      model_count: u.model_count,
      points: u.points,
      is_warlord: u.is_warlord,
      enhancement_raw_name: u.enhancement?.raw_name ?? null,
      enhancement_points: u.enhancement_points,
      wargear: u.wargear.map((w) => ({ raw_name: w.ref.raw_name, count: w.count })),
    }));

    return {
      name: roster.name,
      generated_by: roster.source.generated_by,
      // Id slugs pass through as raw names — collection lookup id-matches
      // exactly before any name lookup.
      faction_raw_name: roster.faction_id,
      // Each detachment carries its own raw name (like units/enhancements), so
      // lower that — it round-trips the display name and re-resolves exactly.
      detachment_raw_names: roster.detachments.map((d) => d.ref.raw_name),
      battle_size_raw:
        roster.battle_size != null ? (BATTLE_SIZE_LABELS[roster.battle_size] ?? null) : null,
      declared_limit: roster.points.declared_limit,
      total_reported: roster.points.total_reported,
      total_computed: roster.points.total_computed,
      units,
      // The canonical shape carries a single primary faction.
      multi_force: false,
    };
  },
};
