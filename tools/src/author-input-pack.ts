/**
 * Build the DSL-authoring input for *new 11e detachments* from a Faction Pack PDF.
 *
 * The stock `author-input.ts` resolves each empty-modifier ability stub to its
 * source rule in the **10e army-assist archive** (unit→datasheet→ability chain).
 * That archive predates the 11e Faction Packs, so the new detachments' rules /
 * stratagems / enhancements aren't in it — the chain returns nothing and the
 * authoring pipeline has no text to classify.
 *
 * This sibling tool fills the gap from the *primary* 11e source: the pack PDF.
 * It captures each card's rule body by bbox coordinate (column-scoped, so the
 * packs' 2-column stratagem layout never interleaves — the failure mode that
 * killed the `-layout` approach) and writes the identical `AuthorInputEntry`
 * shape that `author-batch.ts propose` consumes. Nothing downstream changes.
 *
 * IP firewall: rule prose is captured ONLY into the gitignored authoring worklist
 * `data/_audit/author-input/<faction>.json` (.gitignore). It is never written to
 * the committed `faction-pack-input/` staging (that stays names + metadata only).
 *
 * Scope: only empty-modifier stubs that belong to a detachment (`detachment_id`
 * set) — i.e. the new-detachment rules/stratagems/enhancements the pack covers.
 * Unit-scoped stubs (`detachment_id` null) remain the 10e-archive path's job.
 *
 * Requires `pdftotext` (poppler) on PATH — authoring-time only, not CI.
 *
 * Usage: npx tsx tools/src/author-input-pack.ts --pdf <pack.pdf> --faction <id>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Block,
  isCapsHeader,
  sameColumn,
  stripCp,
  slug,
  titleCase,
  normCaps,
} from "./pack-blocks.js";
import { detachmentSegments } from "./extract-faction-pack.js";
import { hasEmptyModifier } from "./audit-coverage.js";
import type { AuthorInputEntry } from "./author-input.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");
const OUT_DIR = resolve(DATA_ROOT, "_audit", "author-input");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));

/** The start of one card within a detachment: its id, name, column, and top y. */
export interface CardAnchor {
  id: string;
  name: string;
  kind: "detachment" | "stratagem" | "enhancement";
  x: number;
  topGy: number;
}

const STRAT_LABEL = /\bSTRATAGEM$/;
const STRAT_SECTION = /^STRATAGEMS?$/;
/** Table headers that masquerade as caps "enhancement" names (mirror of extractor). */
const NOISE = new Set([
  "RANGED WEAPONS", "MELEE WEAPONS", "RANGE", "WARGEAR OPTIONS", "UNIT COMPOSITION",
  "KEYWORDS", "LEADER", "TRANSPORT", "DAMAGED", "SUPREME COMMANDER",
]);

/** True when the nearest same-column block below `b` is mixed-case prose. */
function hasProseBelow(blocks: Block[], b: Block): boolean {
  return blocks
    .filter((o) => sameColumn(o.x, b.x) && o.gy > b.gy)
    .sort((p, q) => p.gy - q.gy)
    .some((o, i) => i === 0 && /[a-z]/.test(o.text));
}

/**
 * Locate every card-start anchor in a detachment's blocks: the detachment rule
 * (under a DETACHMENT RULE(S) header), each stratagem (its name block above a
 * "<NAME> – <TYPE> STRATAGEM" label), and each enhancement (a caps header with a
 * prose body below). Anchors bound each other's bodies by same-column y order.
 */
export function findAnchors(blocks: Block[]): CardAnchor[] {
  const anchors: CardAnchor[] = [];
  const seen = new Set<string>();
  const push = (a: CardAnchor): void => {
    if (a.id && !seen.has(a.id)) {
      seen.add(a.id);
      anchors.push(a);
    }
  };

  // detachment rule: first caps header beneath the DETACHMENT RULE(S) marker.
  const ruleHeader = blocks.filter((b) => /^DETACHMENT RULES?$/.test(b.text)).sort((a, b) => a.gy - b.gy)[0];
  let ruleSlug = "";
  if (ruleHeader) {
    const rn = blocks
      .filter((b) => sameColumn(b.x, ruleHeader.x) && b.gy > ruleHeader.gy && isCapsHeader(b.text))
      .sort((a, b) => a.gy - b.gy)[0];
    if (rn) {
      ruleSlug = slug(rn.text);
      push({ id: ruleSlug, name: titleCase(rn.text), kind: "detachment", x: rn.x, topGy: rn.gy });
    }
  }

  // stratagems: name block directly above each "… STRATAGEM" label, same column.
  const stratIds = new Set<string>();
  for (const label of blocks.filter((b) => STRAT_LABEL.test(b.text) && !STRAT_SECTION.test(b.text))) {
    const nameBlock = blocks
      .filter((b) => sameColumn(b.x, label.x) && b.gy < label.gy && isCapsHeader(stripCp(b.text).name))
      .sort((a, b) => b.gy - a.gy)[0];
    if (!nameBlock) continue;
    const { name } = stripCp(nameBlock.text);
    const id = slug(name);
    stratIds.add(id);
    push({ id, name: titleCase(name), kind: "stratagem", x: nameBlock.x, topGy: nameBlock.gy });
  }

  // enhancements: remaining caps headers with a prose body below (subtractive,
  // mirroring the extractor) — not stratagem names, the rule, or table noise.
  for (const b of blocks) {
    if (!isCapsHeader(b.text) || NOISE.has(normCaps(b.text))) continue;
    const id = slug(b.text.replace(/ UPGRADE$/, "").trim());
    if (!id || id === ruleSlug || stratIds.has(id) || seen.has(id)) continue;
    if (!hasProseBelow(blocks, b)) continue;
    const name = titleCase(b.text.replace(/ UPGRADE$/, "").trim());
    push({ id, name, kind: "enhancement", x: b.x, topGy: b.gy });
  }

  return anchors;
}

/**
 * Capture a card's rule body: every same-column block strictly below the anchor's
 * name/header, up to the next same-column anchor (the next card's start). Joined
 * in reading order. Column-scoping is what keeps the adjacent column's text out —
 * the whole reason bbox beats `-layout` on these 2-column pages.
 */
export function captureBody(blocks: Block[], anchor: CardAnchor, anchors: CardAnchor[]): string {
  const nextTop = Math.min(
    ...anchors
      .filter((a) => a !== anchor && sameColumn(a.x, anchor.x) && a.topGy > anchor.topGy)
      .map((a) => a.topGy),
    Infinity,
  );
  return blocks
    .filter((b) => sameColumn(b.x, anchor.x) && b.gy > anchor.topGy && b.gy < nextTop)
    .sort((a, b) => a.gy - b.gy)
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const normName = (s: string): string => normCaps(s);

/** Build author-input entries for one faction's new-detachment stubs from its pack. */
export function buildFactionFromPack(faction: string, pdf: string): AuthorInputEntry[] {
  const abilitiesPath = resolve(ENRICHMENT_ROOT, faction, "abilities.json");
  if (!existsSync(abilitiesPath)) return [];
  const abilities: Json[] = readJSON(abilitiesPath);

  // In scope: empty-modifier stubs that belong to a detachment (the new-detachment
  // rules/stratagems/enhancements). Unit-scoped stubs stay the 10e-archive path's.
  const stubs = abilities.filter((a) => a.detachment_id && hasEmptyModifier(a.effect));

  const segments = detachmentSegments(pdf);
  const segById = new Map(segments.map((s) => [s.id, s]));
  const anchorsBySeg = new Map<string, CardAnchor[]>();

  const out: AuthorInputEntry[] = [];
  for (const a of stubs) {
    const base = {
      faction,
      ability_id: a.ability_id as string,
      name: a.name as string,
      unit_ids: (a.unit_ids ?? []) as string[],
      target: (a.effect && typeof a.effect === "object" && a.effect.target) || null,
      scope: a.scope ?? null,
      faction_id: a.faction_id ?? null,
      ability_type: a.ability_type ?? null,
    };
    const seg = segById.get(a.detachment_id);
    if (!seg) {
      out.push({ ...base, resolved: false, reason: `detachment "${a.detachment_id}" not found in pack` });
      continue;
    }
    let anchors = anchorsBySeg.get(seg.id);
    if (!anchors) anchorsBySeg.set(seg.id, (anchors = findAnchors(seg.blocks)));
    const anchor =
      anchors.find((c) => c.id === a.ability_id) ??
      anchors.find((c) => normName(c.name) === normName(a.name));
    if (!anchor) {
      out.push({ ...base, resolved: false, reason: `no card matched "${a.name}" in "${a.detachment_id}"` });
      continue;
    }
    const description = captureBody(seg.blocks, anchor, anchors);
    if (!description) {
      out.push({ ...base, resolved: false, reason: `empty body for "${a.name}"` });
      continue;
    }
    out.push({
      ...base,
      resolved: true,
      src: { datasheet_id: "", src_type: null, parameter: null, phases: null, description },
    });
  }
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  const pdf = argv[argv.indexOf("--pdf") + 1];
  const faction = argv[argv.indexOf("--faction") + 1];
  if (!argv.includes("--pdf") || !argv.includes("--faction") || !pdf || !faction) {
    console.error("Usage: npx tsx tools/src/author-input-pack.ts --pdf <pack.pdf> --faction <id>");
    process.exit(1);
  }

  const entries = buildFactionFromPack(faction, resolve(pdf));
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, `${faction}.json`);
  writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n");
  const resolved = entries.filter((e) => e.resolved).length;
  console.log(`  ${faction}: ${entries.length} stubs, ${resolved} source-resolved → ${outPath}`);
  for (const e of entries.filter((e) => !e.resolved)) console.log(`    unresolved ${e.ability_id}: ${e.reason}`);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) main();
