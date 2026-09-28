/**
 * reconcile-detachment-rules — fill ruleless core detachments from the
 * game-datacards 10e source, which carries BOTH the authoritative
 * rule↔detachment association and the rule text under `rules.detachment[]`:
 *   { detachment, faction, rules: [{ name, cardType:"detachmentRule",
 *                                     rules: [{ text }] }] }
 *
 * For each ruleless core detachment that game-datacards knows, this writes the
 * 3-way link a detachment rule needs (none of which exists yet):
 *   - data/core/<f>/detachments.json : detachment_rule_id (or _ids if >1 rule)
 *   - data/enrichment/<f>/abilities.json : an [APPROX] DSL stub (no prose)
 *   - <store>/<f>.json : raw_text (prose lands ONLY here; source 10e)
 * Rule ids are BARE `slug(rule.name)` to match the existing detachment-rule
 * convention (the 72 already-linked rules + 38 store entries) and to REUSE the
 * orphan store entries already present rather than duplicating them.
 *
 * Fill-only: detachments that already carry a rule are left untouched; existing
 * enrichment/store entries with the same id are reused, never overwritten.
 * New 11e detachments game-datacards lacks are reported (those come from the
 * 11e packs via extract-detachment-rules).
 *
 * Usage:
 *   npx tsx tools/src/reconcile-detachment-rules.ts [factions…] [--store <dir>] [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slug, decodeEntities } from "./pack-blocks.js";
import { STUB_EFFECT } from "./audit-coverage.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "../..");
const args = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const STORE_ROOT = resolve(REPO, flag("--store") ?? "../40kdc-abilities");
const DRY = args.includes("--dry-run");
const CACHE = resolve(REPO, "gdc-cache");
const factionArgs = args.filter((a, i) => !a.startsWith("--") && !["--store"].includes(args[i - 1]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const GDC_BASE = "https://raw.githubusercontent.com/game-datacards/datasources/main/10th/json";
const FACTION_FILES: Record<string, string[]> = {
  "adepta-sororitas": ["adeptasororitas"],
  "adeptus-astartes": ["space_marines", "blacktemplar", "bloodangels", "darkangels", "deathwatch", "spacewolves", "marines_leviathan"],
  "adeptus-custodes": ["adeptuscustodes"], "adeptus-mechanicus": ["adeptusmechanicus"], aeldari: ["aeldari"],
  "agents-of-the-imperium": ["agents"], "astra-militarum": ["astramilitarum"], "chaos-daemons": ["chaosdaemons"],
  "chaos-knights": ["chaosknights"], "chaos-space-marines": ["chaos_spacemarines"], "death-guard": ["deathguard"],
  drukhari: ["drukhari"], "emperors-children": ["emperors_children"], "genestealer-cults": ["gsc"],
  "grey-knights": ["greyknights"], "imperial-knights": ["imperialknights"], "leagues-of-votann": ["votann"],
  necrons: ["necrons"], orks: ["orks"], "tau-empire": ["tau"], "thousand-sons": ["thousandsons"],
  tyranids: ["tyranids"], "world-eaters": ["worldeaters"],
  "black-templars": ["blacktemplar", "space_marines"], "blood-angels": ["bloodangels", "space_marines"],
  "dark-angels": ["darkangels", "space_marines"], deathwatch: ["deathwatch", "space_marines"],
  "space-wolves": ["spacewolves", "space_marines"], "crimson-fists": ["space_marines"], "imperial-fists": ["space_marines"],
  "iron-hands": ["space_marines"], "raven-guard": ["space_marines"], salamanders: ["space_marines"],
  ultramarines: ["space_marines"], "white-scars": ["space_marines"],
};

const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));
const clean = (t: string): string =>
  decodeEntities(String(t ?? "")).replace(/\*\*/g, "").replace(/[■▪●◦]/g, " ").replace(/‑/g, "-").replace(/\s+/g, " ").trim();

const fileCache = new Map<string, Json | null>();
async function gdcFile(base: string): Promise<Json | null> {
  if (fileCache.has(base)) return fileCache.get(base)!;
  const local = join(CACHE, `${base}.json`);
  let data: Json | null = null;
  if (existsSync(local)) { try { data = readJSON(local); } catch { data = null; } }
  if (!data) {
    try {
      const res = await fetch(`${GDC_BASE}/${base}.json`);
      if (res.ok) { data = await res.json(); if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true }); writeFileSync(local, JSON.stringify(data)); }
    } catch { data = null; }
  }
  fileCache.set(base, data);
  return data;
}

/** detachmentSlug -> [{ name, text }] from a gdc file's rules.detachment[] */
function detRules(data: Json): Map<string, { name: string; text: string }[]> {
  const m = new Map<string, { name: string; text: string }[]>();
  const det = data?.rules?.detachment;
  if (!Array.isArray(det)) return m;
  for (const e of det) {
    const ds = slug(e.detachment);
    const rules = (e.rules ?? [])
      .map((r: Json) => ({ name: r.name as string, text: clean((r.rules ?? []).map((x: Json) => x.text).filter(Boolean).join(" ")) }))
      .filter((r: { name: string; text: string }) => r.name && r.text.length > 10);
    if (rules.length && !m.has(ds)) m.set(ds, rules);
  }
  return m;
}

const GV = { edition: "11th", dataslate: "pre-launch-provisional" };
const titleCase = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w/g, (c) => c.toLowerCase());

async function reconcile(faction: string): Promise<{ filled: number; abil: number; store: number; uncovered: string[] } | null> {
  const detPath = join(REPO, "data/core", faction, "detachments.json");
  if (!existsSync(detPath)) return null;
  const enrPath = join(REPO, "data/enrichment", faction, "abilities.json");
  // SM chapters have core detachments but no enrichment dir — their abilities
  // resolve via the parent (adeptus-astartes). Skip them; per-chapter rules are
  // the centralization effort's concern, not a place to duplicate stubs.
  if (!existsSync(enrPath)) return null;
  const dets: Json[] = readJSON(detPath);
  const enr: Json[] = readJSON(enrPath);
  const enrIds = new Set(enr.map((a) => a.ability_id));
  const storePath = join(STORE_ROOT, `${faction}.json`);
  const store: Json[] = existsSync(storePath) ? readJSON(storePath) : [];
  const storeIds = new Set(store.map((e) => e.ability_id));

  // merge gdc detachment rules across the faction's source files (first wins)
  const gdc = new Map<string, { name: string; text: string }[]>();
  const refByDet = new Map<string, string>();
  for (const base of FACTION_FILES[faction] ?? []) {
    const data = await gdcFile(base);
    if (!data) continue;
    for (const [ds, rules] of detRules(data)) if (!gdc.has(ds)) { gdc.set(ds, rules); refByDet.set(ds, `10th/json/${base}.json`); }
  }

  let filled = 0, abil = 0, storeAdded = 0;
  const uncovered: string[] = [];
  for (const d of dets) {
    if (d.detachment_rule_id || (Array.isArray(d.detachment_rule_ids) && d.detachment_rule_ids.length)) continue;
    const rules = gdc.get(slug(d.id)) ?? gdc.get(slug(d.name));
    if (!rules) { uncovered.push(d.id); continue; }
    const ref = refByDet.get(slug(d.id)) ?? refByDet.get(slug(d.name)) ?? "10th/json/?.json";
    const ids: string[] = [];
    for (const r of rules) {
      const id = slug(r.name);
      ids.push(id);
      if (!enrIds.has(id)) {
        enr.push({
          ability_id: id, name: r.name, authored_by: "40kdc-community", game_version: GV, version: "2025-q3",
          supersedes: null, unit_ids: [], faction_id: faction, detachment_id: d.id, ability_type: "detachment",
          behavior: "passive", stub: true, effect: { ...STUB_EFFECT },
          scope: { duration: "permanent" },
          community_notes: "[APPROX] DSL stub — detachment rule; mechanics pending authoring. Full rule in raw-text store.",
        });
        enrIds.add(id); abil++;
      }
      if (!storeIds.has(id)) {
        store.push({
          ability_id: id, name: titleCase(r.name), faction_id: faction, unit_ids: [], ability_type: "detachment",
          game_version: GV, source: { kind: "game-datacards", ref, edition: "10e" }, raw_text: r.text,
        });
        storeIds.add(id); storeAdded++;
      }
    }
    if (ids.length === 1) d.detachment_rule_id = ids[0];
    else d.detachment_rule_ids = ids;
    filled++;
  }

  if (!DRY && (filled || abil || storeAdded)) {
    writeFileSync(detPath, JSON.stringify(dets, null, 2) + "\n");
    writeFileSync(enrPath, JSON.stringify(enr, null, 2) + "\n");
    if (!existsSync(STORE_ROOT)) mkdirSync(STORE_ROOT, { recursive: true });
    writeFileSync(storePath, JSON.stringify(store, null, 2) + "\n");
  }
  return { filled, abil, store: storeAdded, uncovered };
}

async function main(): Promise<void> {
  const factions = factionArgs.length ? factionArgs : Object.keys(FACTION_FILES);
  let tF = 0, tA = 0, tS = 0; const allUncovered: string[] = [];
  for (const f of factions) {
    const r = await reconcile(f);
    if (!r) continue;
    tF += r.filled; tA += r.abil; tS += r.store;
    for (const u of r.uncovered) allUncovered.push(`${f}/${u}`);
    if (r.filled || r.uncovered.length) console.log(`${f.padEnd(24)} filled=${String(r.filled).padStart(3)} (abil +${r.abil}, store +${r.store})  uncovered=${r.uncovered.length}`);
  }
  console.log("—".repeat(60));
  console.log(`TOTAL detachments filled=${tF} (enrichment +${tA}, store +${tS})  |  uncovered (need 11e pack)=${allUncovered.length}${DRY ? "  (DRY RUN)" : ""}`);
  if (allUncovered.length) console.log("uncovered:\n  " + allUncovered.join("\n  "));
}
main().catch((e) => { console.error(e); process.exit(1); });
