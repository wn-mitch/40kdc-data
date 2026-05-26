/**
 * Canonical registry of 10e units carrying the "additional leader" / "second
 * leader" attachment rule — characters that can attach to a unit even when
 * another Leader (e.g. Captain, Chapter Master, Lieutenant) is already
 * attached. In 11e this is formalised as `attachment_role: "support"`.
 *
 * The registry has two layers:
 *
 *   1. **`FROM_UPSTREAM_SCRAPE`** — derived deterministically from army-assist
 *      `Datasheets.json` by scanning `leader_head` for the canonical phrasing
 *      (/already been attached|additional leader|attach this model.*even if/i)
 *      and resolving each datasheet name to our kebab-case unit id via the
 *      10e-archive's `data/core/<faction>/units.json` name table.
 *      shadowboxing's `assets/Datasheets.json` yields the same 40 names.
 *
 *   2. **`MANUAL_OVERLAY`** — units whose 10e "additional leader" rule is
 *      *not* captured by either upstream scraper (data-gap entries) plus
 *      non-character special cases. Each entry needs a one-line comment
 *      naming the SME source so the gap is auditable. This layer is the
 *      reason 40kdc-data exists as a canonical upstream.
 *
 * The exported `KNOWN_SUPPORT_10E` is the merged view. To refresh layer 1,
 * re-run the scan recipe documented above. To add a missing unit (layer 2),
 * edit `MANUAL_OVERLAY` with a comment justifying the entry.
 *
 * Treat every entry as a **proposal** until human review confirms. The port
 * emits a warning if a registry entry doesn't match an archive unit.
 */

/** Layer 1 — derived from army-assist (and confirmed against shadowboxing). */
const FROM_UPSTREAM_SCRAPE: Record<string, readonly string[]> = {
  "adepta-sororitas": ["dialogus", "dogmata", "hospitaller", "imagifier", "ministorum-priest"],

  // Successor chapters share these units via `parent_faction_id`, so
  // chapter-specific variants like `crusade-ancient` (Black Templars) live
  // under adeptus-astartes.
  "adeptus-astartes": [
    "ancient",
    "ancient-in-terminator-armour",
    "apothecary",
    "apothecary-biologis",
    "bladeguard-ancient",
    "castellan",
    "cato-sicarius",
    "crusade-ancient",
    "imperial-space-marine",
    "lieutenant",
    "lieutenant-in-phobos-armour",
    "lieutenant-in-reiver-armour",
    "sanguinary-priest",
  ],

  "adeptus-mechanicus": ["cybernetica-datasmith"],

  "aeldari": ["eldrad-ulthran", "the-visarch", "warlock"],

  "agents-of-the-imperium": ["ministorum-priest"],

  "astra-militarum": ["death-rider-commissar", "ministorum-priest"],

  "chaos-space-marines": ["master-of-executions"],

  "death-guard": [
    "biologus-putrifier",
    "foul-blightspawn",
    "icon-bearer",
    "noxious-blightbringer",
    "plague-surgeon",
    "tallyman",
  ],

  "genestealer-cults": ["biophagus", "clamavus", "locus", "nexos"],

  "necrons": [
    "chronomancer",
    "geomancer",
    "orikan-the-diviner",
    "plasmancer",
    "psychomancer",
    "technomancer",
  ],

  "world-eaters": ["master-of-executions"],
};

/** Layer 2 — units the upstream scrape misses, plus non-character special cases. */
const MANUAL_OVERLAY: Record<string, readonly string[]> = {
  // All three Kroot Shapers carry the additional-leader rule in the GW
  // datasheet, but their `leader_head` in both army-assist and shadowboxing
  // contains only the basic attachment list — the co-attach phrasing was
  // dropped by both community scrapes. (Ethereal is *not* a co-attach Leader;
  // confirmed not missing from the scrape.)
  "tau-empire": ["kroot-flesh-shaper", "kroot-trail-shaper", "kroot-war-shaper"],

  // Cryptothralls is a non-character bodyguard unit that joins a Cryptek-led
  // unit. In 10e the co-attach Leader rule sits on the Cryptek datasheets
  // (covered by layer 1); cryptothralls is included here for the 11e
  // Support-pattern review since it's the "joiner" entity. May need a
  // non-character Support encoding in 11e (`attachment_role` semantically
  // expects a character).
  "necrons": ["cryptothralls"],
};

/** Merge layers 1 and 2 into the public registry. */
function mergeLayers(): Record<string, readonly string[]> {
  const merged: Record<string, string[]> = {};
  for (const [faction, ids] of Object.entries(FROM_UPSTREAM_SCRAPE)) {
    merged[faction] = [...ids];
  }
  for (const [faction, ids] of Object.entries(MANUAL_OVERLAY)) {
    merged[faction] = [...(merged[faction] ?? []), ...ids];
  }
  // Sort each list so output order is stable across re-runs.
  for (const faction of Object.keys(merged)) merged[faction].sort();
  return merged;
}

export const KNOWN_SUPPORT_10E: Record<string, readonly string[]> = mergeLayers();

/** Flatten the registry to faction-prefixed ids for set membership tests. */
export function knownSupportSet(): Set<string> {
  const set = new Set<string>();
  for (const [faction, ids] of Object.entries(KNOWN_SUPPORT_10E)) {
    for (const id of ids) set.add(`${faction}:${id}`);
  }
  return set;
}
