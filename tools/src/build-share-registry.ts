/**
 * Regenerates the share-token id registry (`data/share-registry.json`).
 *
 * The registry assigns every shareable entity id a stable integer index so the
 * list-builder share codec can encode a roster as compact varints instead of
 * full id strings (see `src/share/` and `docs/share-token.md`).
 *
 * **Append-only.** This tool never reorders or drops a slot: existing ids keep
 * their index forever, genuinely-new ids are appended (sorted) at the end, and
 * an id that has vanished from the dataset keeps its slot and is recorded in
 * `tombstones`. Renames are author-curated: move the old id from `tombstones`
 * into `aliases` ({ "old-id": "new-id" }) by hand. These invariants guarantee a
 * newer registry can always decode an older token; only the reverse (an old
 * package meeting a newer token) can fail, and it fails safe (stale-registry).
 *
 * Run intentionally via `npm run registry:build` and commit the diff — this is
 * a migration step, not a per-build codegen. `codegen:data` separately inlines
 * the committed JSON into `src/share/registry.generated.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  alliedRules,
  detachments,
  enhancements,
  factions,
  forceDispositions,
  units,
  wargear,
  weapons,
} from "./data/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, "../../data/share-registry.json");

/** Registry kinds, in a fixed order. The wire format references each by name. */
const KINDS = [
  "faction",
  "detachment",
  "unit",
  "wargear",
  "enhancement",
  "ally_rule",
  "disposition",
] as const;
type KindName = (typeof KINDS)[number];

/** The committed registry artifact. */
interface ShareRegistry {
  version: number;
  kinds: Record<KindName, string[]>;
  /** Renames applied on decode: a tombstoned id → its current replacement. */
  aliases: Record<string, string>;
  /** Ids removed from the dataset but kept as slots so old indices stay valid. */
  tombstones: string[];
}

/** Distinct ids currently in the dataset for each kind, sorted lexically. */
function currentIds(): Record<KindName, Set<string>> {
  const distinct = (ids: Iterable<string>): Set<string> => new Set(ids);
  return {
    faction: distinct(factions.all.map((f) => f.id)),
    detachment: distinct(detachments.all.map((d) => d.id)),
    unit: distinct(units.all.map((u) => u.id)),
    // Loadout refs are either weapons or non-weapon wargear; they share one id
    // space in the token, so the registry merges both collections.
    wargear: distinct([...weapons.all.map((w) => w.id), ...wargear.all.map((w) => w.id)]),
    enhancement: distinct(enhancements.all.map((e) => e.id)),
    ally_rule: distinct(alliedRules.all.map((r) => r.id)),
    disposition: distinct(forceDispositions.all.map((d) => d.id)),
  };
}

function emptyRegistry(): ShareRegistry {
  return {
    version: 0,
    kinds: Object.fromEntries(KINDS.map((k) => [k, [] as string[]])) as Record<
      KindName,
      string[]
    >,
    aliases: {},
    tombstones: [],
  };
}

function loadRegistry(): ShareRegistry {
  if (!existsSync(REGISTRY_PATH)) return emptyRegistry();
  const parsed = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as ShareRegistry;
  // Tolerate a registry authored before a kind existed.
  for (const kind of KINDS) parsed.kinds[kind] ??= [];
  parsed.aliases ??= {};
  parsed.tombstones ??= [];
  return parsed;
}

function main(): void {
  const prev = loadRegistry();
  const current = currentIds();

  const kinds = {} as Record<KindName, string[]>;
  const newlyRemoved: string[] = [];
  let appended = 0;

  for (const kind of KINDS) {
    const existing = prev.kinds[kind] ?? [];
    const have = new Set(existing);
    // Append-only: new ids (sorted) after the preserved existing order.
    const added = [...current[kind]].filter((id) => !have.has(id)).sort();
    kinds[kind] = [...existing, ...added];
    appended += added.length;
    // A previously-allocated id absent from the dataset becomes a tombstone
    // (its slot is retained above, so existing indices never shift).
    for (const id of existing) {
      if (!current[kind].has(id)) newlyRemoved.push(id);
    }
  }

  // Tombstone anything newly removed that the author hasn't already mapped to a
  // replacement via `aliases`. Preserve prior tombstones and aliases verbatim.
  const tombstones = new Set(prev.tombstones);
  for (const id of newlyRemoved) {
    if (!(id in prev.aliases)) tombstones.add(id);
  }

  const changed = appended > 0 || tombstones.size !== prev.tombstones.length;
  const next: ShareRegistry = {
    version: changed ? prev.version + 1 : prev.version,
    kinds,
    aliases: prev.aliases,
    tombstones: [...tombstones].sort(),
  };

  writeFileSync(REGISTRY_PATH, JSON.stringify(next, null, 2) + "\n");

  const counts = KINDS.map((k) => `${k}=${kinds[k].length}`).join(", ");
  if (changed) {
    console.log(
      `Wrote ${REGISTRY_PATH}\n  version ${prev.version} → ${next.version} ` +
        `(+${appended} ids, ${newlyRemoved.length} tombstoned)\n  ${counts}`,
    );
  } else {
    console.log(`No change: ${REGISTRY_PATH} already at version ${next.version}\n  ${counts}`);
  }
}

main();
