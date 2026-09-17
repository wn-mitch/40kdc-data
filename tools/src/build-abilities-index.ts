/**
 * build-abilities-index — regenerate the out-of-repo store's index.json from
 * faction store files + core.json, keyed by faction then canonical ability_id.
 * Stratagems carry structured when/target/effect/restrictions; everything else
 * carries raw_text. The publish (build-abilities.mjs) embeds this index.
 *
 * Usage: npx tsx tools/src/build-abilities-index.ts [--store <dir>] [--dry-run]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRawTextIndex } from "./author-ingest.js";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "../..");
const args = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const STORE_ROOT = resolve(REPO, flag("--store") ?? "../40kdc-abilities");
const DRY = args.includes("--dry-run");

const index = buildRawTextIndex(STORE_ROOT);
let strat = 0, prose = 0;
for (const factionIndex of Object.values(index)) {
  for (const entry of Object.values(factionIndex)) {
    if (typeof entry.raw_text === "string") prose++;
    else strat++;
  }
}
if (!DRY) writeFileSync(resolve(STORE_ROOT, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`index: ${strat + prose} entries (${strat} structured stratagems, ${prose} prose)${DRY ? "  (dry-run)" : ""}`);
