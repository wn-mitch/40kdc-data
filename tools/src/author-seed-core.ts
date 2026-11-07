/**
 * author:seed-core — create the CORE entities a faction pack introduces but that
 * `convert-faction` (army-assist) hasn't produced yet, so the app shows them and
 * the text lookup resolves. The complement of `author:reconcile`:
 *
 *   - reconcile  → links core entities that ALREADY exist to their abilities
 *   - seed-core  → creates the core entities that are MISSING (new detachments /
 *                  stratagems / enhancements a pack added), with `id == ability_id`
 *                  so there is one id across core / abilities.json / dump-prose lookups
 *                  (no divergent mapping to reconcile later)
 *
 * Non-agentic and IP-safe: it writes only structured facts (ids, enums, integer
 * costs, keyword lists) sourced EXPLICITLY from the ingest manifest. It never
 * fabricates a required gameplay value (a stratagem's `cp_cost`/`timing`, an
 * enhancement's `cost`): if a fact the schema requires is absent from the manifest,
 * the entity is SKIPPED and reported — better an honest gap than invented data.
 * Detachments need only id/name/faction_id/game_version, so they always seed.
 *
 * Run AFTER ingest (so abilities + manifest exist) and BEFORE the final
 * `author:reconcile` write (which then links detachment_rule_ids and the
 * detachment's enhancement_ids/stratagem_ids across the freshly-seeded entities).
 *
 * Usage:
 *   npx tsx tools/src/author-seed-core.ts <faction> --manifest <file|dir> [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { kebab } from "./author-seed.js";
import { reconcileFaction } from "./author-reconcile.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const CORE_ROOT = resolve(DATA_ROOT, "core");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");
const STUB_GAME_VERSION = { edition: "11th", dataslate: "pre-launch-provisional" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));
const writeJSON = (p: string, v: Json): void => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

/** Title-case a kebab id for a human-readable default name (Might of the Moritoi). */
const titleCase = (id: string): string =>
  id.split("-").map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1))).join(" ");

interface SeedManifestFacts {
  // present when extraction captured them (see SKILL.md "structural facts"):
  cp_cost?: number; // stratagem
  cost?: number; // enhancement (points)
  timing?: string; // stratagem: once-per-phase|once-per-turn|once-per-battle|unlimited
  player_turn?: string; // stratagem: your-turn|opponent-turn|either
  detachment_points?: number; // detachment (1-3)
  detachment_name?: string; // detachment display name
  phases?: string[];
  behavior?: string;
  faction_id?: string | null;
}

export interface SeedCoreReport {
  faction: string;
  detachmentsCreated: string[];
  stratagemsCreated: string[];
  enhancementsCreated: string[];
  skipped: { ability_id: string; type: string; reason: string }[];
}

function loadManifestFacts(manifestPaths: string[], faction: string): Map<string, Json> {
  const byId = new Map<string, Json>();
  for (const f of manifestPaths) {
    const recs: Json[] = readJSON(f);
    if (!Array.isArray(recs)) continue;
    for (const r of recs) {
      if (r.faction && r.faction !== faction) continue;
      const id = r.ability_id ?? kebab(r.name);
      if (id) byId.set(id, r);
    }
  }
  return byId;
}

/**
 * Pure core: produce the new core entities for `missing` abilities, drawing
 * required facts from `facts`. Returns the records to append + a report; mutates
 * nothing.
 */
export function seedCore(
  faction: string,
  missing: { ability_id: string; ability_type: string; detachment_id: string | null; name: string }[],
  facts: Map<string, Json>,
  existing: { stratagems: Set<string>; enhancements: Set<string>; detachments: Set<string> },
): { detachments: Json[]; stratagems: Json[]; enhancements: Json[]; report: SeedCoreReport } {
  const out = { detachments: [] as Json[], stratagems: [] as Json[], enhancements: [] as Json[] };
  const report: SeedCoreReport = { faction, detachmentsCreated: [], stratagemsCreated: [], enhancementsCreated: [], skipped: [] };
  const detachmentsSeen = new Set(existing.detachments);

  // Ensure a core detachment exists for every detachment_id referenced by a
  // missing ability (detachments need no required gameplay facts → always seed).
  const ensureDetachment = (detId: string | null, f: Json | undefined) => {
    if (!detId || detachmentsSeen.has(detId)) return;
    detachmentsSeen.add(detId);
    const d: Json = {
      id: detId,
      name: f?.detachment_name ?? titleCase(detId),
      faction_id: faction,
      detachment_rule_ids: [], // filled by author:reconcile
      detachment_points: typeof f?.detachment_points === "number" ? f.detachment_points : null,
      enhancement_ids: [],
      stratagem_ids: [],
      game_version: { ...STUB_GAME_VERSION },
    };
    out.detachments.push(d);
    report.detachmentsCreated.push(detId);
  };

  for (const m of missing) {
    const f: SeedManifestFacts = facts.get(m.ability_id) ?? {};
    if (m.ability_type === "detachment") {
      ensureDetachment(m.detachment_id, f);
      continue;
    }
    if (m.ability_type === "stratagem") {
      ensureDetachment(m.detachment_id, f);
      if (existing.stratagems.has(m.ability_id)) continue;
      const phases = Array.isArray(f.phases) && f.phases.length > 0 ? f.phases : null;
      const playerTurn = f.player_turn ?? (f.behavior === "reactive" ? "opponent-turn" : f.behavior ? "your-turn" : null);
      const missingFacts: string[] = [];
      if (typeof f.cp_cost !== "number") missingFacts.push("cp_cost");
      if (!phases) missingFacts.push("phases");
      if (!f.timing) missingFacts.push("timing");
      if (!playerTurn) missingFacts.push("player_turn");
      if (missingFacts.length) {
        report.skipped.push({ ability_id: m.ability_id, type: "stratagem", reason: `missing ${missingFacts.join(",")}` });
        continue;
      }
      out.stratagems.push({
        id: m.ability_id,
        name: m.name,
        category: m.detachment_id ? "detachment" : "core",
        detachment_id: m.detachment_id,
        cp_cost: f.cp_cost,
        phases,
        player_turn: playerTurn,
        timing: f.timing,
        ability_id: m.ability_id,
        game_version: { ...STUB_GAME_VERSION },
      });
      report.stratagemsCreated.push(m.ability_id);
      continue;
    }
    if (m.ability_type === "enhancement") {
      ensureDetachment(m.detachment_id, f);
      if (existing.enhancements.has(m.ability_id)) continue;
      if (!m.detachment_id) {
        report.skipped.push({ ability_id: m.ability_id, type: "enhancement", reason: "no detachment_id (required)" });
        continue;
      }
      // Points come from the MFM, not the pack (SKILL 4b doctrine): when cost is
      // unknown, seed the sanctioned "unconfirmed" marker (cost 0 + provisional)
      // rather than skipping — the entity must exist for links to resolve.
      const known = typeof f.cost === "number";
      out.enhancements.push({
        id: m.ability_id,
        name: m.name,
        detachment_id: m.detachment_id,
        cost: known ? f.cost : 0,
        ability_id: m.ability_id,
        game_version: { ...STUB_GAME_VERSION },
        points_provisional: !known,
      });
      report.enhancementsCreated.push(m.ability_id + (known ? "" : " (cost provisional)"));
      continue;
    }
  }
  return { ...out, report };
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const mIdx = args.indexOf("--manifest");
  const manifestArg = mIdx >= 0 ? args[mIdx + 1] : null;
  const factions = args.filter((a) => !a.startsWith("--") && a !== manifestArg);
  if (factions.length === 0) {
    console.error("Usage: author-seed-core <faction>... --manifest <file|dir> [--dry-run]");
    process.exit(1);
  }

  // Resolve manifest file list (file or directory of *.json).
  const manifestPaths: string[] = [];
  if (manifestArg) {
    const p = resolve(manifestArg);
    if (existsSync(p)) {
      if (statSync(p).isDirectory()) for (const f of readdirSync(p).filter((f) => f.endsWith(".json"))) manifestPaths.push(resolve(p, f));
      else manifestPaths.push(p);
    }
  }

  for (const faction of factions) {
    const abilitiesPath = resolve(ENRICHMENT_ROOT, faction, "abilities.json");
    if (!existsSync(abilitiesPath)) { console.error(`  ${faction}: no abilities.json — skipping`); continue; }
    const abilities: Json[] = readJSON(abilitiesPath);

    // Determine what's missing using the reconciler's own matching (on a copy).
    const dir = resolve(CORE_ROOT, faction);
    const coreFiles: Record<string, Json[]> = {};
    const corePaths: Record<string, string> = {};
    for (const n of ["units", "stratagems", "enhancements", "detachments"]) {
      const p = resolve(dir, `${n}.json`);
      if (existsSync(p)) { coreFiles[n] = readJSON(p); corePaths[n] = p; }
    }
    const copy = JSON.parse(JSON.stringify(coreFiles));
    const recon = reconcileFaction(faction, copy, abilities, false);

    const facts = loadManifestFacts(manifestPaths, faction);
    const existing = {
      stratagems: new Set<string>((coreFiles.stratagems ?? []).map((s) => s.id)),
      enhancements: new Set<string>((coreFiles.enhancements ?? []).map((e) => e.id)),
      detachments: new Set<string>((coreFiles.detachments ?? []).map((d) => d.id)),
    };
    const seeded = seedCore(faction, recon.missingCoreEntities, facts, existing);

    console.log(
      `\n══ ${faction} ══\n  +${seeded.detachments.length} detachments, +${seeded.stratagems.length} stratagems, ` +
        `+${seeded.enhancements.length} enhancements; ${seeded.report.skipped.length} skipped (missing required facts)`,
    );
    if (seeded.report.detachmentsCreated.length) console.log(`    detachments: ${seeded.report.detachmentsCreated.join(", ")}`);
    if (seeded.report.skipped.length) {
      const byReason: Record<string, number> = {};
      for (const s of seeded.report.skipped) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
      console.log(`    skipped: ${Object.entries(byReason).map(([r, n]) => `${n}×(${r})`).join(", ")}`);
    }

    if (!dryRun) {
      mkdirSync(dir, { recursive: true });
      const append = (n: "detachments" | "stratagems" | "enhancements", recs: Json[]) => {
        if (recs.length === 0) return;
        const cur = coreFiles[n] ?? [];
        writeJSON(corePaths[n] ?? resolve(dir, `${n}.json`), [...cur, ...recs]);
      };
      append("detachments", seeded.detachments);
      append("stratagems", seeded.stratagems);
      append("enhancements", seeded.enhancements);
    }
  }
  console.log(`\n${dryRun ? "[dry-run] " : ""}seed-core done. Next: author:reconcile to wire the back-links, then validate + regen.`);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) main();
