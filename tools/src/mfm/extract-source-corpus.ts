/**
 * extract-source-corpus.ts — build the `audit:source-digest` /
 * `backfill:source-digest` input corpus from the private MFM dump.
 *
 * The digest commands take a faction-scoped corpus of source strings
 * (`{ faction_id: { ability_id: source } }`) and never read source prose from
 * the repository, because that prose is GW's. This tool assembles that corpus
 * from `_private/dump.json` through `record-prose.ts`: each annotation's text
 * is the one its own owner prints (datasheet, detachment, army rule or core
 * rule), as a single `raw_text` or a stratagem's `when`/`target`/`effect`/
 * `restrictions` joined by line breaks.
 *
 * Output goes to `_private/source-corpus.json` (git-ignored — it carries GW
 * text). IP: nothing this tool writes goes into committed `data/**`.
 *
 * Resolution is ambiguity-intolerant: an annotation whose owner prints two
 * different texts (two datasheets with different "Twin Guns") is reported,
 * never resolved to either. A wrong source is worse than no source: it would
 * be digested and committed as if the annotation had been authored against it.
 *
 * Usage:
 *   npx tsx src/mfm/extract-source-corpus.ts [--dump <dump.json>] [--out <corpus.json>]
 */
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "node:url";
import { loadRepoProse, type RepoProse } from "./record-prose.js";
import { readJsonArray, REPO_ROOT } from "./repo-files.js";
import { assembleStoreSource, storeSource } from "./store-source.js";
export { assembleStoreSource, storeSource };
export type { StoreSourceAssembly, StoreSourceFragment } from "./store-source.js";

const DEFAULT_OUT = path.join(REPO_ROOT, "_private", "source-corpus.json");

/** Pools that are not live data: fabricated examples and port-audit scratch. */
const EXCLUDED_DIRS = new Set(["_example", "_port-audit"]);
const CORE_FACTION_ID = "_core";

export interface CorpusAnnotation {
  /** The effective faction the digest audit keys by: the record's `faction_id`, else its dir. */
  faction_id: string;
  ability_id: string;
  ability_type?: string;
}

export interface SourceCorpus {
  corpus: Record<string, Record<string, string>>;
  resolved: number;
  total: number;
  unresolved: CorpusAnnotation[];
  ambiguous: CorpusAnnotation[];
}

/** Every live annotation's dump source, keyed by its effective faction. */
export function buildSourceCorpus(repo: RepoProse): SourceCorpus {
  const out: SourceCorpus = { corpus: {}, resolved: 0, total: 0, unresolved: [], ambiguous: [] };
  for (const dir of repo.factions()) {
    if (EXCLUDED_DIRS.has(dir)) continue;
    const fallback = dir.startsWith("_") ? CORE_FACTION_ID : dir;
    const file = path.join(repo.repoRoot, "data", "enrichment", dir, "abilities.json");
    for (const record of readJsonArray<Record<string, unknown>>(file)) {
      const abilityId = (record.ability_id ?? record.id) as string | undefined;
      if (!abilityId) continue;
      out.total += 1;
      const annotation: CorpusAnnotation = {
        faction_id: (record.faction_id as string | undefined) ?? fallback,
        ability_id: abilityId,
        ability_type: record.ability_type as string | undefined,
      };
      const got = repo.forRecord(dir, record);
      const source = got.status === "found" ? storeSource(got.entry as unknown as Record<string, unknown>) : null;
      if (!source) {
        (got.status === "ambiguous" ? out.ambiguous : out.unresolved).push(annotation);
        continue;
      }
      (out.corpus[annotation.faction_id] ??= {})[abilityId] = source;
      out.resolved += 1;
    }
  }
  return out;
}

const byIdentity = (x: CorpusAnnotation, y: CorpusAnnotation): number =>
  x.faction_id < y.faction_id ? -1 : x.faction_id > y.faction_id ? 1 : x.ability_id < y.ability_id ? -1 : x.ability_id > y.ability_id ? 1 : 0;

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i === -1) return undefined;
    const value = argv[i + 1];
    if (!value) throw new Error(`${name} requires a value`);
    return value;
  };
  const outPath = flag("--out") ?? DEFAULT_OUT;
  const result = buildSourceCorpus(loadRepoProse({ dumpPath: flag("--dump") }));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result.corpus, null, 2)}\n`);

  console.log(`source corpus — ${result.resolved}/${result.total} annotations resolved from the dump`);
  console.log(`  unresolved ${result.unresolved.length}  ambiguous ${result.ambiguous.length}`);
  console.log(`  wrote ${path.relative(REPO_ROOT, outPath)}`);
  for (const [label, list] of [["ambiguous (the owner prints two texts)", result.ambiguous], ["unresolved (no owner prints it)", result.unresolved]] as const) {
    if (!list.length) continue;
    console.log(`\n${label}:`);
    for (const a of [...list].sort(byIdentity)) console.log(`  ${a.faction_id}/${a.ability_id}  (${a.ability_type ?? "?"})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
