/**
 * extract-detachment-rules — fill ruleless core detachments with rule text from a
 * faction-pack PDF, for the NEW 11e detachments game-datacards 10e doesn't have
 * (carried-over detachments are filled reliably by reconcile-detachment-rules).
 *
 * Extraction uses the COORDINATE foundation (extractPackCards →
 * detachmentSegments/findAnchors/captureBody), NOT linearized `pdftotext -`.
 * This is what makes the rule→detachment association reliable: each card is
 * located inside its detachment's coordinate region, so there is no guessing from
 * the linear text stream (the failure that mis-assigned "Hymns of Battle").
 *
 * Each fill is a 3-way write (a detachment rule has none of these yet):
 *   - data/core/<f>/detachments.json : detachment_rule_id (or _ids if >1 rule)
 *   - data/enrichment/<f>/abilities.json : an [APPROX] DSL stub (no prose)
 *   - <store>/<f>.json : raw_text (prose lands ONLY here)
 * Rule ids are BARE `slug(name)` (the detachment-rule convention). Fill-only.
 *
 * Usage:
 *   npx tsx tools/src/extract-detachment-rules.ts <pdf> --faction <id> [--store <dir>] [--only <det,det>] [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slug, titleCase } from "./pack-blocks.js";
import { extractPackCards } from "./author-input-pack.js";
import { STUB_EFFECT } from "./audit-coverage.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "../..");
const args = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const PDF = args.find((a, i) => !a.startsWith("--") && !["--faction", "--store", "--only"].includes(args[i - 1]));
const FACTION = flag("--faction");
const STORE_ROOT = resolve(REPO, flag("--store") ?? "../40kdc-abilities");
const DRY = args.includes("--dry-run");
const ONLY = new Set((flag("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
if (!PDF || !FACTION) { console.error("usage: extract-detachment-rules <pdf> --faction <id> [--store <dir>] [--only <ids>] [--dry-run]"); process.exit(2); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));
// drop a leading flavour sentence: keep from the first mechanical-rule opening.
const RULE_START = /(Friendly|Models? |Each time|Once per|While |Add \d|Subtract|Improve|In your|At the (start|end)|You can|This (detachment|unit|model|army)|Designate|Whenever|If (a|an|your|you|this)|Units? |When |Enhancements |Select |Roll |Re-?roll|Your |Enemy |Ranged |Melee )/;
const stripFlavour = (body: string): string => { const m = body.match(RULE_START); return (m && m.index! > 0 ? body.slice(m.index!) : body).trim(); };

// --- pull detachment-rule cards from the pack (coordinate-based) ---
const cards = extractPackCards(resolve(REPO, PDF)).filter((c) => c.kind === "detachment");

// --- match to ruleless core detachments (fill-only) ---
const detPath = join(REPO, "data/core", FACTION, "detachments.json");
const dets: Json[] = existsSync(detPath) ? readJSON(detPath) : [];
const detById = new Map(dets.map((d) => [d.id, d]));
const hasRule = (d: Json): boolean => !!(d.detachment_rule_id || (Array.isArray(d.detachment_rule_ids) && d.detachment_rule_ids.length));

const enrPath = join(REPO, "data/enrichment", FACTION, "abilities.json");
const enr: Json[] = existsSync(enrPath) ? readJSON(enrPath) : [];
const enrIds = new Set(enr.map((a) => a.ability_id));
const storePath = join(STORE_ROOT, `${FACTION}.json`);
const store: Json[] = existsSync(storePath) ? readJSON(storePath) : [];
const storeIds = new Set(store.map((e) => e.ability_id));
const GV = { edition: "11th", dataslate: "pre-launch-provisional" };
const ref = PDF.split(/[\\/]/).pop();

let filled = 0, abil = 0, storeAdded = 0;
const unmatched: string[] = [];
// group cards by detachment (a detachment can carry >1 rule)
const byDet = new Map<string, typeof cards>();
for (const c of cards) { if (!byDet.has(c.detachment_id)) byDet.set(c.detachment_id, []); byDet.get(c.detachment_id)!.push(c); }

for (const [detId, rules] of byDet) {
  const d = detById.get(detId);
  if (!d) { unmatched.push(`${rules.map((r) => r.name).join("/")} (${detId})`); continue; }
  if (hasRule(d)) continue;
  if (ONLY.size && !ONLY.has(detId)) continue;
  const ids: string[] = [];
  for (const r of rules) {
    const text = stripFlavour(r.body);
    if (text.length < 10) continue;
    const id = slug(r.name);
    ids.push(id);
    if (!enrIds.has(id)) {
      enr.push({
        ability_id: id, name: r.name, authored_by: "40kdc-community", game_version: GV, version: "2025-q3",
        supersedes: null, unit_ids: [], faction_id: FACTION, detachment_id: detId, ability_type: "detachment",
        behavior: "passive", stub: true, effect: { ...STUB_EFFECT },
        scope: { duration: "permanent" },
        community_notes: "[APPROX] DSL stub — detachment rule; mechanics pending authoring. Full rule in raw-text store.",
      });
      enrIds.add(id); abil++;
    }
    if (!storeIds.has(id)) {
      store.push({
        ability_id: id, name: titleCase(r.name), faction_id: FACTION, unit_ids: [], ability_type: "detachment",
        game_version: GV, source: { kind: "pdf", edition: "11e", ref }, raw_text: text,
      });
      storeIds.add(id); storeAdded++;
    }
  }
  if (ids.length === 1) d.detachment_rule_id = ids[0];
  else if (ids.length > 1) d.detachment_rule_ids = ids;
  if (ids.length) filled++;
}

const ruleless = dets.filter((d) => !hasRule(d)).map((d) => d.id);
console.log(`${FACTION}: detachment-rule cards=${cards.length} | filled=${filled} (abilities +${abil}, store +${storeAdded}) | unmatched=${unmatched.length}`);
if (unmatched.length) console.log("  unmatched:", unmatched.slice(0, 10).join(" | "));
if (ruleless.length) console.log(`  still ruleless (${ruleless.length}):`, ruleless.slice(0, 12).join(", ") + (ruleless.length > 12 ? ` … +${ruleless.length - 12}` : ""));

if (!DRY && (filled || abil || storeAdded)) {
  writeFileSync(detPath, JSON.stringify(dets, null, 2) + "\n");
  writeFileSync(enrPath, JSON.stringify(enr, null, 2) + "\n");
  if (!existsSync(STORE_ROOT)) mkdirSync(STORE_ROOT, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2) + "\n");
}
if (DRY) console.log("  (dry-run — nothing written)");
