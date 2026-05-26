/**
 * Port 10e archive faction data forward as an 11e provisional seed (Section 6).
 *
 * Usage:
 *   npx tsx tools/src/port-10e-faction.ts <faction-id>
 *   npx tsx tools/src/port-10e-faction.ts --all
 *
 * Reads data/{core,enrichment}/<faction>/*.json from the `10e-archive` ref,
 * applies the per-entity 11e transforms, writes the result into the working
 * tree, emits a per-faction audit under data/_port-audit/, and validates the
 * output against the (bumped) schemas. Exits non-zero on validation failure.
 *
 * Distinct from convert-faction.ts (the army-assist bootstrap); this script is
 * purpose-built for the archive→11e port and reads only from the git archive.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createValidator } from "./schema-loader.js";
import { validateFiles } from "./validate.js";
import { KNOWN_SUPPORT_10E } from "./known-support-10e.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ARCHIVE_REF = "10e-archive";
const AUDIT_DIR = "data/_port-audit";

/** The provisional 11e dataslate every ported entity is stamped with. */
export const TARGET_GAME_VERSION = { edition: "11th", dataslate: "pre-launch-provisional" };

const ENTITY_ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface AuditItem {
  category: string;
  entity_type: string;
  entity_id: string;
  detail: string;
}

// ─── git archive access ──────────────────────────────────────────────

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Faction directory names present under data/core/ on the archive ref. */
export function archiveFactions(): string[] {
  const out = git(["ls-tree", "-d", "--name-only", ARCHIVE_REF, "data/core/"]);
  return out
    .split("\n")
    .map((l) => basename(l.trim()))
    .filter((f) => f && f !== "_example")
    .sort();
}

/** JSON files present for a faction in a data area on the archive ref. */
function archiveFiles(area: "core" | "enrichment", faction: string): string[] {
  let out: string;
  try {
    out = git(["ls-tree", "-r", "--name-only", ARCHIVE_REF, `data/${area}/${faction}`]);
  } catch {
    return [];
  }
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((p) => p.endsWith(".json"));
}

function readArchiveJSON(path: string): Json {
  return JSON.parse(git(["show", `${ARCHIVE_REF}:${path}`]));
}

function archiveSha(): string {
  return git(["rev-parse", ARCHIVE_REF]).trim();
}

// ─── DSL inspection helpers ──────────────────────────────────────────

/** Collect every `type` string found anywhere in a DSL subtree. */
function collectTypes(node: Json, acc: string[]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectTypes(v, acc);
  } else if (node && typeof node === "object") {
    if (typeof node.type === "string") acc.push(node.type);
    for (const v of Object.values(node)) collectTypes(v, acc);
  }
}

/** Ability ids granted via `ability-grant` whose id mentions cover. */
export function coverGrants(effect: Json): string[] {
  const hits: string[] = [];
  const walk = (node: Json): void => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
    } else if (node && typeof node === "object") {
      if (node.type === "ability-grant") {
        const aid = String(node.modifier?.ability_id ?? "");
        if (aid.toLowerCase().includes("cover")) hits.push(aid);
      }
      for (const v of Object.values(node)) walk(v);
    }
  };
  walk(effect);
  return [...new Set(hits)];
}

/** Charge/Fights-First effect types 11e may make redundant. */
export function chargeTimingTypes(effect: Json): string[] {
  const types: string[] = [];
  collectTypes(effect, types);
  return [...new Set(types.filter((t) => t === "fight-first" || t === "charged-this-turn"))];
}

/** True if any string value equals the 10e engagement-range constant (1"). */
export function referencesOneInch(entity: Json): boolean {
  let found = false;
  const walk = (node: Json): void => {
    if (found) return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
    } else if (node && typeof node === "object") {
      for (const v of Object.values(node)) walk(v);
    } else if (typeof node === "string" && node.trim() === '1"') {
      found = true;
    }
  };
  walk(entity);
  return found;
}

// ─── per-entity transforms (pure) ────────────────────────────────────

/** Stamp the provisional 11e game_version onto an entity. */
export function bump(entity: Json): Json {
  return { ...entity, game_version: { ...TARGET_GAME_VERSION } };
}

/**
 * units.json: bump, mark points provisional, set attachment_role.
 *
 * Precedence: a unit in `supportIds` (curated registry) becomes `"support"`,
 * even if it isn't a leader_id (the cryptothralls case — non-character joiner).
 * Otherwise, a `leader_id` becomes `"leader"`. Non-attaching units get no role.
 */
export function portUnit(unit: Json, leaderIds: Set<string>, supportIds: Set<string>): Json {
  const out = bump(unit);
  out.points_provisional = true;
  if (supportIds.has(unit.id)) {
    out.attachment_role = "support";
  } else if (leaderIds.has(unit.id)) {
    out.attachment_role = "leader";
  }
  return out;
}

/** enhancements.json: bump, mark provisional, default-fill upgrade_tag/max_targets. */
export function portEnhancement(enh: Json): Json {
  const out = bump(enh);
  out.points_provisional = true;
  if (out.upgrade_tag === undefined) out.upgrade_tag = false;
  if (out.max_targets === undefined) out.max_targets = 1;
  return out;
}

/** detachments.json: bump, default-fill detachment_points/force_dispositions. */
export function portDetachment(det: Json): Json {
  const out = bump(det);
  if (out.detachment_points === undefined) out.detachment_points = null;
  if (out.force_dispositions === undefined) out.force_dispositions = [];
  return out;
}

/** leader-attachments.json: drop the retired max_leaders_per_unit, then bump. */
export function portLeaderAttachment(la: Json): Json {
  const { max_leaders_per_unit: _drop, ...rest } = la;
  void _drop;
  return bump(rest);
}

// ─── faction port ────────────────────────────────────────────────────

interface PortResult {
  faction: string;
  written: string[];
  summary: Record<string, number>;
}

function transformCore(name: string, entities: Json[], leaderIds: Set<string>, supportIds: Set<string>): Json[] {
  switch (name) {
    case "units.json":
      return entities.map((u) => portUnit(u, leaderIds, supportIds));
    case "enhancements.json":
      return entities.map(portEnhancement);
    case "detachments.json":
      return entities.map(portDetachment);
    case "leader-attachments.json":
      return entities.map(portLeaderAttachment);
    default:
      // factions, weapons, unit-compositions, stratagems — bump only
      return entities.map(bump);
  }
}

function writeJSON(rel: string, data: Json): void {
  const out = resolve(ROOT, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
}

function portFaction(faction: string): PortResult {
  if (!ENTITY_ID_RE.test(faction)) {
    throw new Error(`Invalid faction id: ${JSON.stringify(faction)}`);
  }

  const core: Record<string, Json[]> = {};
  for (const path of archiveFiles("core", faction)) core[basename(path)] = readArchiveJSON(path);
  if (Object.keys(core).length === 0) {
    throw new Error(`No core data for faction '${faction}' on ${ARCHIVE_REF}`);
  }
  const enrichment: Record<string, Json[]> = {};
  for (const path of archiveFiles("enrichment", faction)) {
    enrichment[basename(path)] = readArchiveJSON(path);
  }

  const leaderIds = new Set<string>((core["leader-attachments.json"] ?? []).map((e) => e.leader_id));
  const supportIds = new Set<string>(KNOWN_SUPPORT_10E[faction] ?? []);

  const items: AuditItem[] = [];
  const written: string[] = [];

  // Warn before the port runs if a registry entry doesn't match an archive
  // unit — silent typos would otherwise mean the role is never applied.
  const unitIds = new Set<string>((core["units.json"] ?? []).map((u) => u.id));
  for (const candidateId of supportIds) {
    if (!unitIds.has(candidateId)) {
      console.warn(`  ⚠ ${faction}: support registry lists '${candidateId}' but no such unit in archive`);
    }
  }

  // Core files.
  for (const [name, entities] of Object.entries(core)) {
    const out = transformCore(name, entities, leaderIds, supportIds);
    const rel = `data/core/${faction}/${name}`;
    writeJSON(rel, out);
    written.push(rel);
  }

  // Record an audit entry per unit the registry assigned `attachment_role:
  // "support"` to — both as a visible roster of the call and so summary.md
  // surfaces the list for review.
  for (const candidateId of supportIds) {
    if (!unitIds.has(candidateId)) continue;
    items.push({
      category: "support-assigned",
      entity_type: "unit",
      entity_id: candidateId,
      detail: `Assigned attachment_role: "support" from the curated registry. To revert, remove from tools/src/known-support-10e.ts and re-run the port.`,
    });
  }

  // Enrichment files + ability audits.
  for (const [name, entities] of Object.entries(enrichment)) {
    if (name === "abilities.json") {
      for (const a of entities) {
        const cover = coverGrants(a.effect ?? {});
        if (cover.length) {
          items.push({
            category: "cover-ability",
            entity_type: "ability",
            entity_id: a.ability_id,
            detail: `Grants ${cover.join(", ")}; 11e cover is −1 BS (not +1 Sv) — re-check the granted ability's definition.`,
          });
        }
        const charge = chargeTimingTypes(a.effect ?? {});
        if (charge.length) {
          items.push({
            category: "charge-timing",
            entity_type: "ability",
            entity_id: a.ability_id,
            detail: `Uses ${charge.join(", ")}; 11e charging grants Fights First by default — check for redundancy.`,
          });
        }
        if (referencesOneInch(a)) {
          items.push({
            category: "engagement-range",
            entity_type: "ability",
            entity_id: a.ability_id,
            detail: `References 1"; 11e engagement range is 2" — confirm intent.`,
          });
        }
      }
    }
    const rel = `data/enrichment/${faction}/${name}`;
    writeJSON(rel, entities.map(bump));
    written.push(rel);
  }

  // Bulk-review categories: every detachment / stratagem needs human work later.
  const bulkReview: Json = {};
  if (core["detachments.json"]) {
    bulkReview["detachment-disposition"] = core["detachments.json"].map((d) => d.id);
  }
  if (core["stratagems.json"]) {
    bulkReview["stratagem-type"] = core["stratagems.json"].length;
  }

  const summary: Record<string, number> = {};
  for (const it of items) summary[it.category] = (summary[it.category] ?? 0) + 1;

  writeJSON(`${AUDIT_DIR}/${faction}.json`, {
    faction,
    ported_from_ref: archiveSha(),
    summary,
    items,
    bulk_review: bulkReview,
  });

  return { faction, written, summary };
}

/** Rebuild summary.md from every per-faction audit json currently on disk. */
function regenerateSummary(): void {
  const dir = resolve(ROOT, AUDIT_DIR);
  const audits = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf-8")))
    .sort((a, b) => a.faction.localeCompare(b.faction));

  const itemsOf = (a: Json, category: string): AuditItem[] =>
    (a.items as AuditItem[]).filter((i) => i.category === category);

  const lines: string[] = [
    "# 10e → 11e port — audit queue",
    "",
    "Generated by `tools/src/port-10e-faction.ts`. Each item below needs human",
    "review before the provisional seed is treated as confirmed 11e data.",
    "",
  ];

  // Flat roster of units the port assigned attachment_role: "support".
  lines.push("## Support — assigned by the port");
  lines.push("");
  lines.push(
    "The units below were written with `attachment_role: \"support\"` by the port,",
    "sourced from the curated 10e \"additional leader\" registry",
    "(`tools/src/known-support-10e.ts`).",
    "",
    "To **revert** any entry: remove the id from the registry and re-run",
    "`npx tsx tools/src/port-10e-faction.ts --all`. The port is the durable",
    "source of truth — don't hand-edit `attachment_role` in faction units.json.",
    "",
  );
  const assigned = audits.flatMap((a) =>
    itemsOf(a, "support-assigned").map((i) => ({ faction: a.faction, id: i.entity_id })),
  );
  for (const c of assigned) {
    lines.push(`- \`${c.faction}\` / **${c.id}**`);
  }
  lines.push("", `_${assigned.length} units assigned._`, "");

  // Per-faction detail with names for the other discretionary flags.
  lines.push("## Per-faction detail", "");
  for (const a of audits) {
    const cover = itemsOf(a, "cover-ability").map((i) => i.entity_id);
    const charge = itemsOf(a, "charge-timing").map((i) => i.entity_id);
    const engage = itemsOf(a, "engagement-range").map((i) => i.entity_id);
    const support = itemsOf(a, "support-assigned").map((i) => i.entity_id);
    const dets = a.bulk_review["detachment-disposition"] ?? [];
    const strats = a.bulk_review["stratagem-type"] ?? 0;
    if (!cover.length && !charge.length && !engage.length && !support.length && !dets.length && !strats) {
      continue;
    }
    lines.push(`### ${a.faction}`, "");
    if (support.length) lines.push(`- Support candidates: ${fmtIds(support)}`);
    if (cover.length) lines.push(`- Cover abilities (rework \`benefit-of-cover\` → −1 BS): ${fmtIds(cover)}`);
    if (charge.length) lines.push(`- Charge-timing / Fights First (check redundancy): ${fmtIds(charge)}`);
    if (engage.length) lines.push(`- Engagement-range (1" → 2"): ${fmtIds(engage)}`);
    if (dets.length) lines.push(`- Detachments needing DP + Force Disposition assignment (${dets.length}): ${fmtIds(dets)}`);
    if (strats) lines.push(`- Stratagems pending 11e type-enum reconciliation: ${strats}`);
    lines.push("");
  }

  const out = resolve(ROOT, `${AUDIT_DIR}/summary.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join("\n") + "\n");
}

/** Render a list of ids as inline-code, comma-separated. */
function fmtIds(ids: string[]): string {
  return ids.map((i) => `\`${i}\``).join(", ");
}

async function validateFaction(faction: string): Promise<number> {
  const ajv = createValidator();
  const core = await validateFiles(ajv, `core/${faction}/**/*.json`);
  const enrich = await validateFiles(ajv, `enrichment/${faction}/**/*.json`);
  const failed = core.failed + enrich.failed;
  if (failed) {
    for (const e of [...core.errors, ...enrich.errors]) {
      const where = e.index >= 0 ? `[${e.index}]` : "";
      console.error(`    ✗ ${basename(e.file)}${where}: ${e.errors.map((x) => `${x.path} ${x.message}`).join("; ")}`);
    }
  }
  return failed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help") {
    console.log("Usage: npx tsx tools/src/port-10e-faction.ts <faction-id>");
    console.log("       npx tsx tools/src/port-10e-faction.ts --all");
    console.log("       npx tsx tools/src/port-10e-faction.ts --summary  (rebuild audit summary only)");
    process.exit(args[0] === "--help" ? 0 : 1);
  }

  if (args[0] === "--summary") {
    regenerateSummary();
    console.log(`Rebuilt ${AUDIT_DIR}/summary.md`);
    return;
  }

  const factions = args[0] === "--all" ? archiveFactions() : [args[0]];
  let totalFailed = 0;

  for (const faction of factions) {
    console.log(`\n▶ porting ${faction}`);
    const res = portFaction(faction);
    for (const w of res.written) console.log(`  ✓ ${w}`);
    const failed = await validateFaction(faction);
    if (failed) {
      console.error(`  ✗ ${faction}: ${failed} validation failure(s)`);
      totalFailed += failed;
    } else {
      const cats = Object.entries(res.summary).map(([k, v]) => `${k}=${v}`).join(", ");
      console.log(`  ✓ ${faction} validates (audit: ${cats || "none"})`);
    }
  }

  regenerateSummary();
  console.log(`\n${factions.length} faction(s) ported. Audit queue: ${AUDIT_DIR}/summary.md`);
  if (totalFailed) process.exit(1);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
