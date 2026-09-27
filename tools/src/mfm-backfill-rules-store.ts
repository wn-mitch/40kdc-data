/**
 * mfm-backfill-rules-store — populate the out-of-repo raw-text store (sibling
 * repo `../40kdc-abilities`) with detachment-rule and army-rule prose from the
 * GW MFM dump, as the established `mfm` source kind. Fill-only with precedence.
 *
 * The dump carries rule prose in `rule_container_component` rows keyed by
 * `detachmentRuleId` / `armyRuleId`, ordered by `displayOrder`. Rule text is
 * assembled from the mechanical component types (`text`, `textBold`,
 * `boxedText`, `bullets`, `header` as inline section labels, `accordion` /
 * `triggerEffectAccordion` as titled sub-rules); presentation/flavor components
 * (`loreAccordion`, `quote`, `image`) are skipped.
 *
 * A rule printed by more than one publication (e.g. a codex army rule reprinted
 * in a Combat Patrol box) is deduped per (faction, slug): a non-Combat-Patrol,
 * non-Legends publication wins; ties fall to the longest assembled text.
 *
 * Matching mirrors the repo's ability-id conventions: a rule's slug is tried
 * bare (`nameToId`) and detachment-scoped (`detachmentScopedId`) against the
 * faction's enrichment abilities; only rules that resolve to an existing
 * enrichment `ability_id` are written.
 *
 * Precedence (never clobber better text): existing 11e `pdf` > new `mfm` (11e) >
 * 10e `game-datacards`. A missing key is FILLED with mfm; a `game-datacards`
 * (10e) entry is UPGRADED to mfm; a `pdf`/`mfm` entry is left untouched.
 *
 * IP: this writes ONLY to the out-of-repo store, NEVER into this repo. Dry-run
 * by default; pass --write to mutate the store, then rebuild the index.
 *
 * Usage:
 *   npx tsx tools/src/mfm-backfill-rules-store.ts [faction…] [--store <dir>] [--dump <path>] [--write]
 */
import * as fs from "fs";
import * as path from "path";
import { loadDump } from "./mfm/loader.js";
import { collectRules, type DumpRule } from "./mfm/dump-prose.js";
import { ENRICHMENT_DIR, REPO_ROOT, readJsonArray } from "./mfm/repo-files.js";
const argv = process.argv.slice(2);
const write = argv.includes("--write");
const storeFlag = argv.indexOf("--store");
const STORE_ROOT = storeFlag >= 0 ? argv[storeFlag + 1] : path.join(REPO_ROOT, "..", "40kdc-abilities");
const dumpFlag = argv.indexOf("--dump");
const DUMP_PATH = dumpFlag >= 0 ? argv[dumpFlag + 1] : undefined;
const factionArgs = argv.filter(
  (a, i) => !a.startsWith("--") && argv[i - 1] !== "--store" && argv[i - 1] !== "--dump"
);

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
interface EnrichmentAbility {
  ability_id: string;
  name: string;
  ability_type: string;
  game_version?: { edition: string; dataslate: string };
}
interface DirResult {
  scope: string;
  added: number;
  upgraded: number; // game-datacards → mfm
  keptBetter: number; // pdf/mfm left untouched
  unmatched: string[]; // dump rules with no enrichment ability id
}

function run(): void {
  const dump = loadDump(DUMP_PATH);
  const rules = collectRules(dump);
  const byDir = new Map<string, DumpRule[]>();
  for (const r of rules) (byDir.get(r.factionDir) ?? byDir.set(r.factionDir, []).get(r.factionDir)!).push(r);

  const results: DirResult[] = [];
  for (const dir of [...byDir.keys()].sort()) {
    if (factionArgs.length > 0 && !factionArgs.includes(dir)) continue;
    const abilities = readJsonArray<EnrichmentAbility>(path.join(ENRICHMENT_DIR, dir, "abilities.json"));
    if (abilities.length === 0) continue;
    const abilityById = new Map(abilities.map((a) => [a.ability_id, a]));

    const storePath = path.join(STORE_ROOT, `${dir}.json`);
    const store = readJsonArray<StoreEntry>(storePath);
    const byId = new Map(store.map((e) => [e.ability_id, e]));

    const res: DirResult = { scope: dir, added: 0, upgraded: 0, keptBetter: 0, unmatched: [] };
    const newEntries: StoreEntry[] = [];
    let dirty = false;

    for (const rule of byDir.get(dir)!) {
      // A dump detachment/army rule can only correspond to a detachment- or
      // faction-typed ability. A bare name-slug can collide with a same-named
      // unit ability (e.g. a detachment rule "Onslaught" vs the unit ability
      // "onslaught") — matching on type prevents clobbering the unit's prose.
      const slug = rule.slugs.find((s) => {
        const a = abilityById.get(s);
        return a != null && (a.ability_type === "detachment" || a.ability_type === "faction");
      });
      if (!slug) {
        // A `■`-section sub-rule the repo doesn't model separately is expected
        // noise (its prose already ships inside the parent rule's entry).
        if (!rule.isSub) res.unmatched.push(rule.slugs[0]);
        continue;
      }
      const ability = abilityById.get(slug)!;
      const existing = byId.get(slug);
      if (!existing) {
        newEntries.push({
          ability_id: slug,
          name: ability.name,
          faction_id: dir,
          unit_ids: [],
          ability_type: ability.ability_type,
          game_version: ability.game_version ?? DEFAULT_GV,
          source: { kind: "mfm", ref: rule.ref, edition: "11e" },
          raw_text: rule.text,
        });
        byId.set(slug, newEntries[newEntries.length - 1]);
        res.added++;
        dirty = true;
      } else if (existing.source?.kind === "game-datacards") {
        // upgrade 10e → mfm 11e: replace text + source in place
        delete existing.when;
        delete existing.target;
        delete existing.effect;
        delete existing.restrictions;
        existing.raw_text = rule.text;
        existing.source = { kind: "mfm", ref: rule.ref, edition: "11e" };
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
    if (res.added || res.upgraded || res.keptBetter || res.unmatched.length) results.push(res);
  }

  const sum = (f: (r: DirResult) => number) => results.reduce((a, r) => a + f(r), 0);
  console.log(`MFM store backfill (detachment/army rules) → ${STORE_ROOT}`);
  for (const r of results) {
    console.log(`  ${r.scope}: +${r.added} added, ${r.upgraded} upgraded, ${r.keptBetter} kept-better`);
    if (r.unmatched.length) console.log(`    unmatched in enrichment: ${r.unmatched.sort().join(", ")}`);
  }
  console.log(
    `TOTAL: ${sum((r) => r.added)} added, ${sum((r) => r.upgraded)} upgraded (game-datacards→mfm), ` +
      `${sum((r) => r.keptBetter)} kept (pdf/mfm), ${sum((r) => r.unmatched.length)} unmatched.`
  );
  if (!write) console.log("DRY RUN — no store files written. Re-run with --write, then rebuild index.json.");
  else console.log("Applied. Next: npx tsx tools/src/build-abilities-index.ts --store " + STORE_ROOT);
}

run();
