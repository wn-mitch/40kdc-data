/**
 * mfm-backfill-store — populate the out-of-repo raw-text store (sibling repo
 * `../40kdc-abilities`) with stratagem prose from the GW MFM dump, as a new
 * `mfm` source kind. Fill-only with precedence.
 *
 * The dump carries stratagem prose as already-separated structured fields
 * (`whenRules`/`targetRules`/`effectRules`/`restrictionRules`), which map directly
 * to the store's stratagem record (`when`/`target`/`effect`/`restrictions`) — no
 * section parsing needed. Each repo stratagem is keyed by `ability_id ?? id` and
 * matched to the dump by `detachmentScopedId(name, detachment)` (bare `nameToId`
 * for the core stratagems), mirroring the Phase 6 reconciler.
 *
 * Precedence (never clobber better text): existing 11e `pdf` > new `mfm` (11e) >
 * 10e `game-datacards`. So a missing key is FILLED with mfm; a `game-datacards`
 * (10e) entry is UPGRADED to mfm; a `pdf`/`mfm` entry is left untouched.
 *
 * IP: this writes ONLY to the out-of-repo store, NEVER into this repo. Dry-run by
 * default; pass --write to mutate the store, then rebuild the index.
 *
 * Usage:
 *   npx tsx tools/src/mfm-backfill-store.ts [faction…] [--store <dir>] [--write]
 */
import * as fs from "fs";
import * as path from "path";
import { loadDump } from "./mfm/loader.js";
import { stratagemProseById, type StratagemProse } from "./mfm/dump-prose.js";
import { REPO_ROOT, readJsonArray, CORE_DIR } from "./mfm/repo-files.js";
import { repoDirs } from "./mfm/faction-map.js";


const argv = process.argv.slice(2);
const write = argv.includes("--write");
const storeFlag = argv.indexOf("--store");
const STORE_ROOT = storeFlag >= 0 ? argv[storeFlag + 1] : path.join(REPO_ROOT, "..", "40kdc-abilities");
const factionArgs = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--store");

const DEFAULT_GV = { edition: "11th", dataslate: "launch" };

interface StoreEntry {
  ability_id: string;
  name: string;
  faction_id: string;
  unit_ids: string[];
  ability_type: string;
  game_version: { edition: string; dataslate: string };
  source: { kind: string; ref: string; edition: string };
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
  raw_text?: string;
  [k: string]: unknown;
}
interface RepoStrat {
  id: string;
  name: string;
  ability_id?: string | null;
  game_version?: { edition: string; dataslate: string };
}
/** repo stratagem id → dump prose. */
function buildDumpText(): Map<string, StratagemProse> {
  return stratagemProseById(loadDump());
}

interface DirResult {
  scope: string;
  added: number;
  upgraded: number; // game-datacards → mfm
  keptBetter: number; // pdf/mfm left untouched
  missingInDump: number;
}

function run(): void {
  const dumpText = buildDumpText();
  const scopes: string[] = ["", ...[...repoDirs()].sort()].filter(
    (d) => factionArgs.length === 0 || factionArgs.includes(d || "core")
  );
  const results: DirResult[] = [];

  for (const dir of scopes) {
    const stratPath = dir ? path.join(CORE_DIR, dir, "stratagems.json") : path.join(CORE_DIR, "stratagems.json");
    if (!fs.existsSync(stratPath)) continue;
    const faction = dir || "core";
    const strats = readJsonArray<RepoStrat>(stratPath);

    const storePath = path.join(STORE_ROOT, `${faction}.json`);
    const store = readJsonArray<StoreEntry>(storePath);
    const byId = new Map(store.map((e) => [e.ability_id, e]));

    const res: DirResult = { scope: faction, added: 0, upgraded: 0, keptBetter: 0, missingInDump: 0 };
    const newEntries: StoreEntry[] = [];
    let dirty = false;

    for (const s of strats) {
      const key = s.ability_id ?? s.id;
      const text = dumpText.get(s.id);
      if (!text || (!text.when && !text.target && !text.effect && !text.restrictions)) {
        res.missingInDump++;
        continue;
      }
      const fields: Partial<StoreEntry> = {};
      if (text.when) fields.when = text.when;
      if (text.target) fields.target = text.target;
      if (text.effect) fields.effect = text.effect;
      if (text.restrictions) fields.restrictions = text.restrictions;

      const existing = byId.get(key);
      if (!existing) {
        newEntries.push({
          ability_id: key,
          name: s.name,
          faction_id: faction === "core" ? "core" : faction,
          unit_ids: [],
          ability_type: "stratagem",
          game_version: s.game_version ?? DEFAULT_GV,
          source: { kind: "mfm", ref: text.ref, edition: "11e" },
          ...fields,
        });
        byId.set(key, newEntries[newEntries.length - 1]);
        res.added++;
        dirty = true;
      } else if (existing.source?.kind === "game-datacards") {
        // upgrade 10e → mfm 11e: replace text + source in place
        delete existing.when;
        delete existing.target;
        delete existing.effect;
        delete existing.restrictions;
        delete existing.raw_text;
        Object.assign(existing, fields);
        existing.source = { kind: "mfm", ref: text.ref, edition: "11e" };
        res.upgraded++;
        dirty = true;
      } else {
        res.keptBetter++; // pdf or mfm — authoritative, don't clobber
      }
    }

    if (write && dirty) {
      fs.mkdirSync(STORE_ROOT, { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify([...store, ...newEntries], null, 2) + "\n");
    }
    if (res.added || res.upgraded || res.keptBetter) results.push(res);
  }

  const sum = (f: (r: DirResult) => number) => results.reduce((a, r) => a + f(r), 0);
  console.log(`MFM store backfill (stratagems) → ${STORE_ROOT}`);
  for (const r of results)
    console.log(`  ${r.scope}: +${r.added} added, ${r.upgraded} upgraded, ${r.keptBetter} kept-better`);
  console.log(
    `TOTAL: ${sum((r) => r.added)} added, ${sum((r) => r.upgraded)} upgraded (game-datacards→mfm), ` +
      `${sum((r) => r.keptBetter)} kept (pdf/mfm).`
  );
  if (!write) console.log("DRY RUN — no store files written. Re-run with --write, then rebuild index.json.");
  else console.log("Applied. Next: npx tsx tools/src/build-abilities-index.ts --store " + STORE_ROOT);
}

run();
