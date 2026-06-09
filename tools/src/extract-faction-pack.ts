/**
 * Standardized extractor for GW 11e Faction Pack PDFs → IP-safe staging JSON.
 *
 * The faction packs are the structural source of truth for detachments,
 * stratagems, and enhancements. This tool pulls the *facts* out of a pack —
 * detachment names, stratagem names + CP cost + type + phase, enhancement names,
 * detachment-rule names — and writes them to `data/_audit/faction-pack-input/
 * <faction>.json` for human review before they are merged into `data/core/`.
 *
 * IP firewall: this tool MUST NOT emit GW rules/effect prose. It reads the
 * `WHEN:` line of a stratagem card only to *derive* the structured phase /
 * player-turn fields; the prose itself is never written to the staging file.
 * Stored output is names + numeric/enum metadata only.
 *
 * The packs are *supplements*, not complete codexes: a pack contains only the
 * extra/updated detachments. Absence from a pack does not imply removal. This
 * tool reports only what a pack actually contains; completeness is reconciled
 * against GW's full Detachment-Points list separately.
 *
 * Parsing uses `pdftotext -bbox-layout`, which emits per-word coordinates. GW
 * lays each card out as discrete text blocks; we locate the "<DET> – <TYPE>
 * STRATAGEM" label block, then read the name block directly above it, the CP
 * block in the column gutter, and the `WHEN:` block below — all by coordinate.
 * This is layout-independent (column positions differ across packs and pages).
 * Anything the parser cannot determine is left null and recorded in a per-entry
 * `flags` array for the reviewer.
 *
 * Requires `pdftotext` (poppler) on PATH — authoring-time only, not CI.
 *
 * Usage:
 *   npx tsx tools/src/extract-faction-pack.ts <pdf-path> --faction <faction-id>
 *   npx tsx tools/src/extract-faction-pack.ts --all --dir <pack-pdf-dir>
 */
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Block,
  runPdftotext,
  allBlocks,
  slug,
  titleCase,
  normCaps,
  isCapsHeader,
  sameColumn,
  stripCp,
} from "./pack-blocks.js";

export { slug, titleCase } from "./pack-blocks.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const OUT_DIR = resolve(DATA_ROOT, "_audit", "faction-pack-input");

/** Pack-filename fragment → 40kdc faction id. `--all` uses this to route packs. */
const PACK_FACTION: Array<[fragment: string, faction: string]> = [
  ["space-marines", "adeptus-astartes"],
  ["black_templars", "black-templars"],
  ["blood_angels", "blood-angels"],
  ["dark_angels", "dark-angels"],
  ["space_wolves", "space-wolves"],
  ["deathwatch", "deathwatch"],
  ["grey_knights", "grey-knights"],
];

const STRAT_TYPE: Record<string, string> = {
  "BATTLE TACTIC": "battle-tactic",
  "STRATEGIC PLOY": "strategic-ploy",
  "EPIC DEED": "epic-deed",
  WARGEAR: "wargear",
};
const TYPE_RE = /(BATTLE TACTIC|STRATEGIC PLOY|EPIC DEED|WARGEAR)\s+STRATAGEM$/;
const PHASES = ["command", "movement", "shooting", "charge", "fight"] as const;
// Note: "Legends Datasheets" (not bare "Legends") — else it eats the detachment
// "Legends of Saga and Song".
const SECTION_TERMINATORS = /^(Datasheets|Rules Updates|Legends Datasheets|Imperial Armour|Index)\b/i;

export interface ExtractedStratagem {
  id: string;
  name: string;
  type: string | null;
  cp_cost: number | null;
  phases: string[];
  player_turn: string | null;
  timing: string | null;
  flags: string[];
}
export interface ExtractedEnhancement {
  id: string;
  name: string;
  cost: null; // never in the pack — comes from the Munitorum Field Manual
  flags: string[];
}
export interface ExtractedDetachment {
  id: string;
  name: string;
  detachment_rule_name: string | null;
  stratagems: ExtractedStratagem[];
  enhancements: ExtractedEnhancement[];
  flags: string[];
}
export interface PackExtract {
  faction_id: string;
  source_pack: string;
  detachments: ExtractedDetachment[];
}

/** Datasheet/table headers that can masquerade as caps "enhancement" names. */
const DATASHEET_NOISE = new Set([
  "RANGED WEAPONS", "MELEE WEAPONS", "RANGE", "WARGEAR OPTIONS", "UNIT COMPOSITION",
  "KEYWORDS", "LEADER", "TRANSPORT", "DAMAGED", "SUPREME COMMANDER",
]);
/** Non-detachment section headers that bound the last detachment's content. */
const SECTION_MARKER = /^(DATASHEETS|RULES UPDATES|LEGENDS DATASHEETS|IMPERIAL ARMOUR|INDEX)\b/;

/** Derive phases / player-turn from a `WHEN:` line (the prose itself is discarded). */
function parseWhen(when: string): { phases: string[]; player_turn: string | null; flag?: string } {
  const low = when.toLowerCase();
  const phases = PHASES.filter((p) => low.includes(`${p} phase`));
  let player_turn: string | null = null;
  if (/opponent['’]?s?\b/.test(low)) player_turn = "opponent-turn";
  else if (/\byour\b/.test(low) && phases.length) player_turn = "your-turn";
  else if (phases.length) player_turn = "either";
  const flag = phases.length ? undefined : "phase-review"; // e.g. "any phase"
  return { phases, player_turn, flag };
}

/** Extract stratagems, enhancements, and rule name from a detachment's blocks. */
export function parseDetachmentBlocks(blocks: Block[], detachmentId: string): Omit<ExtractedDetachment, "id" | "name"> {
  const flags: string[] = [];
  const labels = blocks.filter((b) => /\bSTRATAGEM$/.test(b.text) && !/^STRATAGEMS?$/.test(b.text));
  const cpBlocks = blocks.filter((b) => /^\d+\s?CP$/.test(b.text));
  const whenBlocks = blocks.filter((b) => /^WHEN:/i.test(b.text));

  // --- detachment rule name: first caps header under a DETACHMENT RULE(S) marker
  let detachment_rule_name: string | null = null;
  const ruleHeader = blocks.filter((b) => /^DETACHMENT RULES?$/.test(b.text)).sort((a, b) => a.gy - b.gy)[0];
  if (ruleHeader) {
    const rn = blocks
      .filter((b) => sameColumn(b.x, ruleHeader.x) && b.gy > ruleHeader.gy && isCapsHeader(b.text))
      .sort((a, b) => a.gy - b.gy)[0];
    if (rn) detachment_rule_name = titleCase(rn.text);
  }

  // --- stratagems: keyed off each "<…> <TYPE> STRATAGEM" label block.
  const stratagems: ExtractedStratagem[] = [];
  const seenS = new Set<string>();
  for (const label of labels) {
    const typeM = label.text.match(TYPE_RE);
    const type = typeM ? STRAT_TYPE[typeM[1]] : null;

    // name: nearest caps-header block directly above the label, same column
    const nameBlock = blocks
      .filter((b) => sameColumn(b.x, label.x) && b.gy < label.gy && isCapsHeader(stripCp(b.text).name))
      .sort((a, b) => b.gy - a.gy)[0];
    if (!nameBlock) continue;
    const { name, cp: inlineCp } = stripCp(nameBlock.text);
    const id = slug(name);
    if (!id || seenS.has(id)) continue;
    seenS.add(id);

    // cp: inline on the name block, else the CP block within the card window.
    // Card layouts differ: new detachments put CP at the name's right edge on
    // the name row; reprints put it in the left gutter below the label. So scan
    // a window [name row → just below label] × [card width] and pick the CP
    // nearest the name horizontally (avoids grabbing the adjacent column's CP).
    let cp = inlineCp;
    if (cp === null) {
      const inCard = cpBlocks
        .filter((b) => b.gy >= nameBlock.gy - 15 && b.gy <= label.gy + 70 && b.x >= nameBlock.x - 70 && b.x <= nameBlock.x + 260)
        .sort((a, b) => Math.abs(a.x - nameBlock.x) - Math.abs(b.x - nameBlock.x))[0];
      if (inCard) cp = Number(inCard.text.match(/(\d+)/)![1]);
    }

    // phase: the first WHEN: block below the label in the same column
    const when = whenBlocks
      .filter((b) => sameColumn(b.x, label.x) && b.gy >= label.gy)
      .sort((a, b) => a.gy - b.gy)[0];
    const sFlags: string[] = [];
    let phases: string[] = [];
    let player_turn: string | null = null;
    if (when) {
      const w = parseWhen(when.text);
      phases = w.phases;
      player_turn = w.player_turn;
      if (w.flag) sFlags.push(w.flag);
    } else {
      sFlags.push("phase-missing");
    }
    if (!type) sFlags.push("type-missing");
    if (cp === null) sFlags.push("cp-missing");
    sFlags.push("timing-missing"); // pack rarely states once-per-phase/turn/battle

    stratagems.push({ id, name: titleCase(name), type, cp_cost: cp, phases, player_turn, timing: null, flags: sFlags });
  }

  if (!detachment_rule_name) flags.push("rule-name-missing");

  // --- enhancements (subtractive): a detachment page's caps headers are the
  //     title, tagline, rule name, section words, stratagem names, type labels,
  //     and enhancement names. Remove every known category; the rest are
  //     enhancements. Each must be a name+description pair, i.e. followed by a
  //     mixed-case prose block in its column. Cost is never printed in the pack.
  const ruleSlug = detachment_rule_name ? slug(detachment_rule_name) : "";
  const hasProseBelow = (b: Block): boolean =>
    blocks
      .filter((o) => sameColumn(o.x, b.x) && o.gy > b.gy)
      .sort((p, q) => p.gy - q.gy)
      .some((o, i) => i === 0 && /[a-z]/.test(o.text)); // nearest block below is prose
  const enhancements: ExtractedEnhancement[] = [];
  const seenE = new Set<string>();
  for (const b of blocks) {
    if (!isCapsHeader(b.text) || DATASHEET_NOISE.has(normCaps(b.text))) continue;
    const isUpgrade = / UPGRADE$/.test(b.text);
    const name = b.text.replace(/ UPGRADE$/, "").trim();
    const id = slug(name);
    if (!id || seenE.has(id) || seenS.has(id)) continue; // skip stratagem names
    if (id === detachmentId || id === ruleSlug) continue; // skip title / rule name
    if (!hasProseBelow(b)) continue; // enhancements always have a description
    seenE.add(id);
    enhancements.push({
      id,
      name: titleCase(name),
      cost: null,
      flags: ["cost-missing", "name-needs-review", ...(isUpgrade ? ["upgrade-tag?"] : [])],
    });
  }
  if (!enhancements.length) flags.push("no-enhancements-parsed");

  return { detachment_rule_name, stratagems, enhancements, flags };
}

/**
 * Parse the pack's table of contents (first two pages) into the ordered list of
 * detachments with their start pages. Uses non-layout extraction so the two
 * columns don't interleave; dot leaders are private-font glyphs (non-word
 * chars), so a TOC row is `<Name><2+ non-word><page#>`. Entries are kept only
 * between the "Detachments" header and the first non-detachment section.
 */
export function parseToc(tocText: string): Array<{ name: string; page: number; section?: boolean }> {
  const rows: Array<{ name: string; page: number; section?: boolean }> = [];
  let inDetachments = false;
  let sawHeader = false;
  for (const line of tocText.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Za-z0-9'’ \-]+?)[^\w\s]{2,}\s*(\d+)\s*$/);
    if (!m) continue;
    const name = m[1].trim();
    const page = Number(m[2]);
    if (/^Detachments$/i.test(name)) {
      inDetachments = true;
      sawHeader = true;
      continue;
    }
    if (sawHeader && SECTION_TERMINATORS.test(name)) {
      if (inDetachments) rows.push({ name, page, section: true }); // bounds the last detachment
      inDetachments = false;
      continue;
    }
    if (inDetachments) rows.push({ name, page });
  }
  return rows;
}

/** One detachment's slice of the pack: its id, display name, and bounded blocks. */
export interface DetachmentSegment {
  id: string;
  name: string;
  blocks: Block[];
}

/**
 * Segment a pack into per-detachment block slices. Detachment names come (ordered)
 * from the TOC; content boundaries come from block positions: each detachment runs
 * from its title block to the next detachment, the next non-detachment section
 * marker, or a ~2-page backstop — whichever comes first. Shared by `extractPack`
 * (names/metadata) and `author-input-pack` (rule bodies) so both segment identically.
 */
export function detachmentSegments(pdf: string): DetachmentSegment[] {
  const names = parseToc(runPdftotext(["-f", "1", "-l", "2", pdf, "-"]))
    .filter((t) => !t.section)
    .map((t) => t.name);
  const blocks = allBlocks(pdf);

  // start of each detachment = its title block (exact uppercase name match, first
  // occurrence). Stratagem labels like "NAME – TYPE STRATAGEM" are not exact, so
  // they don't collide with the title.
  const starts = names
    .map((name) => {
      const title = blocks.filter((b) => normCaps(b.text) === normCaps(name)).sort((a, b) => a.gy - b.gy)[0];
      return title ? { name, gy: title.gy } : null;
    })
    .filter((s): s is { name: string; gy: number } => s !== null)
    .sort((a, b) => a.gy - b.gy);
  const sectionGys = blocks.filter((b) => SECTION_MARKER.test(normCaps(b.text))).map((b) => b.gy).sort((a, b) => a - b);

  const segments: DetachmentSegment[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].gy;
    const nextDet = starts[i + 1]?.gy ?? Infinity;
    const nextSection = sectionGys.find((gy) => gy > start) ?? Infinity;
    // Backstop: a detachment is at most ~2 pages (gy page stride is 100000).
    // Bounds the last detachment when no datasheets/section divider block is
    // detected, so it can't bleed into the datasheet pages that follow.
    const end = Math.min(nextDet, nextSection, start + 200000);
    segments.push({
      id: slug(starts[i].name),
      name: starts[i].name,
      blocks: blocks.filter((b) => b.gy >= start && b.gy < end),
    });
  }
  return segments;
}

export function extractPack(pdf: string, faction: string): PackExtract {
  const detachments: ExtractedDetachment[] = detachmentSegments(pdf).map((seg) => ({
    id: seg.id,
    name: seg.name,
    ...parseDetachmentBlocks(seg.blocks, seg.id),
  }));
  return { faction_id: faction, source_pack: basename(pdf), detachments };
}

function factionForPack(file: string): string | undefined {
  const lower = file.toLowerCase();
  return PACK_FACTION.find(([frag]) => lower.includes(frag))?.[1];
}

function main(): void {
  const argv = process.argv.slice(2);
  mkdirSync(OUT_DIR, { recursive: true });

  let jobs: Array<{ pdf: string; faction: string }> = [];
  if (argv[0] === "--all") {
    const dirIdx = argv.indexOf("--dir");
    const dir = dirIdx === -1 ? undefined : argv[dirIdx + 1];
    if (!dir) {
      console.error("Usage: extract-faction-pack.ts --all --dir <pack-pdf-dir>");
      process.exit(1);
    }
    for (const f of readdirSync(dir)) {
      if (!/faction_pack.*\.pdf$/i.test(f)) continue;
      const faction = factionForPack(f);
      if (faction) jobs.push({ pdf: resolve(dir, f), faction });
    }
  } else {
    const facIdx = argv.indexOf("--faction");
    const pdf = argv[0];
    if (!pdf || facIdx === -1) {
      console.error("Usage: extract-faction-pack.ts <pdf-path> --faction <faction-id>");
      process.exit(1);
    }
    jobs = [{ pdf: resolve(pdf), faction: argv[facIdx + 1] }];
  }

  for (const { pdf, faction } of jobs) {
    const result = extractPack(pdf, faction);
    const out = resolve(OUT_DIR, `${faction}.json`);
    writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
    const nStrat = result.detachments.reduce((a, d) => a + d.stratagems.length, 0);
    const nEnh = result.detachments.reduce((a, d) => a + d.enhancements.length, 0);
    console.log(
      `  ${faction}: ${result.detachments.length} detachments, ${nStrat} stratagems, ${nEnh} enhancements → ${out}`,
    );
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) main();
