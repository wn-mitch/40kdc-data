/**
 * mfm-refresh-store — make the out-of-repo raw-text store (sibling repo `../40kdc-abilities`)
 * match the GW MFM dump. The dump is the live game's own data, so where it has an ability's
 * prose that prose wins, whatever the store held before (10e game-datacards, pack PDFs, manual
 * JSON, or an older dump read).
 *
 * Covered: every core stratagem, every enrichment ability (unit abilities, enhancements,
 * detachment and army rules, core rules), matched as the repo's ids are built. Stratagems keep
 * their when/target/effect/restrictions fields; everything else is `raw_text` with `**bold**`
 * keywords and line breaks kept. An entry the dump cannot resolve is left as it is.
 *
 * IP: this writes ONLY to the out-of-repo store, never into this repo. Dry run by default;
 * pass --write to change the store, then rebuild its index.json.
 *
 * Usage:
 *   npx tsx tools/src/mfm-refresh-store.ts [faction…] [--store <dir>] [--dump <path>] [--write]
 */
import * as fs from "fs";
import * as path from "path";

import { buildProseIndex, collectRules, resolveProse, stratagemProseById, type DumpRule, type StratagemProse } from "./mfm/dump-prose.js";
import { loadDump } from "./mfm/loader.js";
import { CORE_DIR, ENRICHMENT_DIR, REPO_ROOT, readJsonArray } from "./mfm/repo-files.js";

type Text = { when?: string; target?: string; effect?: string; restrictions?: string; raw_text?: string };
type StoreEntry = Record<string, unknown> & Text & { ability_id: string; source?: { kind?: string } };
type Ability = { ability_id?: string; id?: string; name?: string; ability_type?: string; unit_ids?: string[]; detachment_id?: string | null; game_version?: unknown };

const TEXT_FIELDS = ["when", "target", "effect", "restrictions", "raw_text"] as const;
const DEFAULT_GV = { edition: "11th", dataslate: "launch" };

export type RefreshCounts = {
  added: number;
  /** Replaced, by the kind of source the store held before. */
  replaced: Record<string, number>;
  unchanged: number;
  unresolved: number;
  /** The abilities the dump has no prose for, as `ability_type:ability_id`. */
  unresolvedIds: string[];
  /** Extra entries dropped where the store held one ability twice and the dump resolved it. */
  duplicatesRemoved: number;
};

/** A store entry's text fields, for comparing with the dump's. */
function textOf(entry: Text): Text {
  return Object.fromEntries(TEXT_FIELDS.filter((f) => entry[f] !== undefined).map((f) => [f, entry[f]])) as Text;
}

function stratagemText(prose: StratagemProse): Text | null {
  const text: Text = {};
  if (prose.when) text.when = prose.when;
  if (prose.target) text.target = prose.target;
  if (prose.effect) text.effect = prose.effect;
  if (prose.restrictions) text.restrictions = prose.restrictions;
  return Object.keys(text).length ? text : null;
}

/** The store file for a repo data directory: `_core` and the core stratagems live in core.json. */
const storeFaction = (dir: string) => (dir === "" || dir === "_core" ? "core" : dir);

export function refreshStore(options: { storeRoot: string; dumpPath?: string; factions?: string[]; write: boolean }) {
  const dump = loadDump(options.dumpPath);
  const stratagems = stratagemProseById(dump);
  const rules = new Map<string, DumpRule[]>();
  for (const rule of collectRules(dump)) rules.set(rule.factionDir, [...(rules.get(rule.factionDir) ?? []), rule]);
  const prose = buildProseIndex(dump);

  // Everything the repo names, grouped by the store file it belongs to.
  const wanted = new Map<string, Array<{ ability: Ability; text: Text; ref: string } | { ability: Ability; text: null }>>();
  const want = (dir: string, ability: Ability, found: { text: Text; ref: string } | null) => {
    const faction = storeFaction(dir);
    if (options.factions?.length && !options.factions.includes(faction)) return;
    wanted.set(faction, [...(wanted.get(faction) ?? []), found ? { ability, ...found } : { ability, text: null }]);
  };

  const coreDirs = ["", ...fs.readdirSync(CORE_DIR).filter((d) => fs.statSync(path.join(CORE_DIR, d)).isDirectory())];
  for (const dir of coreDirs) {
    const file = dir ? path.join(CORE_DIR, dir, "stratagems.json") : path.join(CORE_DIR, "stratagems.json");
    if (!fs.existsSync(file)) continue;
    for (const s of readJsonArray<Ability & { id: string }>(file)) {
      const found = stratagems.get(s.id);
      const text = found ? stratagemText(found) : null;
      want(dir, { ...s, ability_id: s.ability_id ?? s.id, ability_type: "stratagem" }, text ? { text, ref: found!.ref } : null);
    }
  }
  for (const dir of fs.readdirSync(ENRICHMENT_DIR).sort()) {
    const file = path.join(ENRICHMENT_DIR, dir, "abilities.json");
    if (dir.startsWith("_example") || !fs.existsSync(file)) continue;
    for (const a of readJsonArray<Ability>(file)) {
      const id = a.ability_id ?? a.id;
      if (!id) continue;
      const ability = { ...a, ability_id: id };
      if (a.ability_type === "stratagem") {
        // A stratagem's prose is written once, from its core record above.
        continue;
      }
      if (a.ability_type === "detachment" || a.ability_type === "faction") {
        const rule = (rules.get(dir) ?? []).find((r) => r.slugs.includes(id));
        if (rule) {
          want(dir, ability, { text: { raw_text: rule.text }, ref: rule.ref });
          continue;
        }
      }
      const hit = resolveProse(ability, prose);
      want(dir, ability, hit ? { text: { raw_text: hit.text }, ref: hit.ref } : null);
    }
  }

  const perFaction = new Map<string, RefreshCounts>();
  for (const [faction, items] of [...wanted].sort(([a], [b]) => a.localeCompare(b))) {
    const storePath = path.join(options.storeRoot, `${faction}.json`);
    const store = fs.existsSync(storePath) ? readJsonArray<StoreEntry>(storePath) : [];
    const byId = new Map(store.map((e) => [e.ability_id, e]));
    const counts: RefreshCounts = { added: 0, replaced: {}, unchanged: 0, unresolved: 0, unresolvedIds: [], duplicatesRemoved: 0 };
    // One entry per ability: where the store holds an id twice, the first is kept and refreshed.
    const firstIndex = new Map<string, number>();
    store.forEach((e, i) => { if (!firstIndex.has(e.ability_id)) firstIndex.set(e.ability_id, i); });
    for (const [id, i] of firstIndex) byId.set(id, store[i]!);
    const added: StoreEntry[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const id = item.ability.ability_id!;
      if (seen.has(id)) continue; // one entry per (faction, ability_id); the first source wins
      seen.add(id);
      if (!item.text) {
        counts.unresolved++;
        counts.unresolvedIds.push(`${item.ability.ability_type ?? "?"}:${id}`);
        continue;
      }
      const source = { kind: "mfm", ref: item.ref, edition: "11e" };
      const existing = byId.get(id);
      if (!existing) {
        const entry: StoreEntry = {
          ability_id: id,
          name: item.ability.name ?? id,
          faction_id: faction,
          unit_ids: item.ability.unit_ids ?? [],
          ability_type: item.ability.ability_type ?? "unit",
          ...(item.ability.detachment_id ? { detachment_id: item.ability.detachment_id } : {}),
          game_version: item.ability.game_version ?? DEFAULT_GV,
          source,
          ...item.text,
        };
        added.push(entry);
        byId.set(id, entry);
        counts.added++;
        continue;
      }
      if (JSON.stringify(textOf(existing)) === JSON.stringify(item.text) && existing.source?.kind === "mfm") {
        counts.unchanged++;
        continue;
      }
      const before = existing.source?.kind ?? "unknown";
      for (const field of TEXT_FIELDS) delete existing[field];
      Object.assign(existing, item.text, { source });
      counts.replaced[before] = (counts.replaced[before] ?? 0) + 1;
    }
    // Drop the extra copies of an id the dump resolved; the kept one now carries the dump text.
    const resolved = new Set(items.filter((item) => item.text).map((item) => item.ability.ability_id!));
    const kept = store.filter((e, i) => !(resolved.has(e.ability_id) && firstIndex.get(e.ability_id) !== i));
    counts.duplicatesRemoved = store.length - kept.length;
    store.splice(0, store.length, ...kept);
    perFaction.set(faction, counts);
    const changed = counts.added + counts.duplicatesRemoved + Object.values(counts.replaced).reduce((a, b) => a + b, 0);
    if (options.write && changed) {
      fs.mkdirSync(options.storeRoot, { recursive: true });
      fs.writeFileSync(storePath, `${JSON.stringify([...store, ...added], null, 2)}\n`);
    }
  }
  return perFaction;
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const storeRoot = flag("--store") ?? path.join(REPO_ROOT, "..", "40kdc-abilities");
  const factions = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--store" && argv[i - 1] !== "--dump");
  const write = argv.includes("--write");
  const result = refreshStore({ storeRoot, dumpPath: flag("--dump"), factions, write });

  const total: RefreshCounts = { added: 0, replaced: {}, unchanged: 0, unresolved: 0, unresolvedIds: [], duplicatesRemoved: 0 };
  console.log(`MFM store refresh (the dump wins) → ${storeRoot}`);
  for (const [faction, c] of result) {
    const replaced = Object.entries(c.replaced).map(([k, n]) => `${n} ${k}`).join(", ") || "0";
    console.log(`  ${faction}: +${c.added} added, replaced ${replaced}, ${c.unchanged} unchanged, ${c.unresolved} unresolved`);
    total.added += c.added;
    total.unchanged += c.unchanged;
    total.unresolved += c.unresolved;
    total.duplicatesRemoved += c.duplicatesRemoved;
    total.unresolvedIds.push(...c.unresolvedIds.map((id) => `${faction}/${id}`));
    for (const [k, n] of Object.entries(c.replaced)) total.replaced[k] = (total.replaced[k] ?? 0) + n;
  }
  console.log(`TOTAL: +${total.added} added, replaced ${JSON.stringify(total.replaced)}, ${total.unchanged} unchanged, ${total.unresolved} unresolved, ${total.duplicatesRemoved} duplicate entries removed.`);
  if (argv.includes("--unresolved")) for (const id of total.unresolvedIds) console.log(`  unresolved ${id}`);
  console.log(write ? `Applied. Next: npx tsx tools/src/build-abilities-index.ts --store ${storeRoot}` : "DRY RUN — no store files written. Re-run with --write.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main();
