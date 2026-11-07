/**
 * migrate-ability-ids — align detachment-scoped ability_ids to the canonical
 * pattern `<name-slug>-<detachment-slug>` (stratagems + enhancements). Unit /
 * faction abilities keep their bare id.
 *
 * Source of truth = data/core (stratagems/enhancements carry detachment_id). We
 * compute each entity's new id, build a per-faction old->new map, then rewrite:
 *   - core stratagems/enhancements ids (and ability_id when set)
 *   - core detachment link fields + unit ability_ids
 *   - enrichment ability_ids
 *
 * Ambiguity: an old id shared by >1 entity (pre-existing duplicate-id bug) is
 * resolved per reference by the referrer's detachment context when available;
 * otherwise left unchanged and REPORTED.
 *
 * Usage: npx tsx tools/src/migrate-ability-ids.ts [--apply]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slug } from "./pack-blocks.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "../..");
const CORE = resolve(REPO, "data/core");
const ENRICH = resolve(REPO, "data/enrichment");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));
const write = (p: string, v: Json): void => { if (APPLY) writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); };
const factions = readdirSync(CORE).filter((f) => !f.startsWith("_") && existsSync(join(CORE, f)));

// faction -> oldKey -> { byDet: Map<detachmentId,newId>, all: Set<newId> }
const maps = new Map<string, Map<string, { byDet: Map<string, string>; all: Set<string> }>>();
for (const faction of factions) {
  const m = new Map<string, { byDet: Map<string, string>; all: Set<string> }>();
  const load = (k: string): Json[] => { const p = join(CORE, faction, `${k}.json`); return existsSync(p) ? readJSON(p) : []; };
  for (const e of [...load("stratagems"), ...load("enhancements")]) {
    const det = e.detachment_id; if (!det) continue;
    const oldKey = e.ability_id ?? e.id;
    const newId = `${slug(e.name)}-${det}`;
    if (!m.has(oldKey)) m.set(oldKey, { byDet: new Map(), all: new Set() });
    m.get(oldKey)!.byDet.set(det, newId);
    m.get(oldKey)!.all.add(newId);
  }
  maps.set(faction, m);
}

const leftovers: string[] = [];
let remapped = 0;
/** resolve an old key reference to its new id, using detachment ctx for ambiguous keys. */
function remap(faction: string, oldKey: string, ctxDet?: string | null): string {
  const m = maps.get(faction); if (!m) return oldKey;
  const entry = m.get(oldKey); if (!entry) return oldKey; // not a detachment-scoped id
  if (entry.all.size === 1) { remapped++; return [...entry.all][0]; }
  if (ctxDet && entry.byDet.has(ctxDet)) { remapped++; return entry.byDet.get(ctxDet)!; }
  leftovers.push(`${faction}:${oldKey} (ambiguous: ${[...entry.all].join(", ")})`);
  return oldKey;
}
const remapList = (faction: string, ids: Json, ctxDet?: string | null): Json =>
  Array.isArray(ids) ? ids.map((x) => (typeof x === "string" ? remap(faction, x, ctxDet) : x)) : ids;

for (const faction of factions) {
  const fp = (k: string): string => join(CORE, faction, `${k}.json`);
  // 1. core stratagems/enhancements: set own id (+ ability_id when present) to canonical
  for (const k of ["stratagems", "enhancements"]) {
    if (!existsSync(fp(k))) continue;
    const arr: Json[] = readJSON(fp(k));
    for (const e of arr) {
      if (!e.detachment_id) continue;
      const newId = `${slug(e.name)}-${e.detachment_id}`;
      if (e.ability_id != null) e.ability_id = newId;
      e.id = newId;
    }
    write(fp(k), arr);
  }
  // 2. core detachments: remap link fields (rule/enh/strat id lists), using the detachment's own id as context
  if (existsSync(fp("detachments"))) {
    const dets: Json[] = readJSON(fp("detachments"));
    for (const d of dets) {
      const ctx = d.id;
      for (const field of ["detachment_rule_id"]) if (typeof d[field] === "string") d[field] = remap(faction, d[field], ctx);
      for (const field of ["detachment_rule_ids", "enhancement_ids", "stratagem_ids"]) if (Array.isArray(d[field])) d[field] = remapList(faction, d[field], ctx);
    }
    write(fp("detachments"), dets);
  }
  // 3. core units: ability_ids (rarely detachment-scoped, but safe)
  if (existsSync(fp("units"))) {
    const units: Json[] = readJSON(fp("units"));
    for (const u of units) if (Array.isArray(u.ability_ids)) u.ability_ids = remapList(faction, u.ability_ids);
    write(fp("units"), units);
  }
  // 4. enrichment abilities: ability_id (no detachment ctx on the entry -> ambiguous ones reported)
  const ep = join(ENRICH, faction, "abilities.json");
  if (existsSync(ep)) {
    const abils: Json[] = readJSON(ep);
    for (const a of abils) if (typeof a.ability_id === "string") a.ability_id = remap(faction, a.ability_id, a.detachment_id ?? null);
    write(ep, abils);
  }
}

console.log(`factions: ${factions.length}  |  references remapped: ${remapped}  |  leftovers (ambiguous, unresolved): ${leftovers.length}`);
if (leftovers.length) console.log(leftovers.slice(0, 30).map((s) => "  " + s).join("\n"));
console.log(APPLY ? "APPLIED." : "(dry-run — nothing written; pass --apply to write)");
