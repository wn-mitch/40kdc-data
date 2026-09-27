/**
 * ability-prune.ts — drop the enrichment abilities of units the live game no longer
 * carries (Legends / Forge World, absent from the MFM dump), and every reference to
 * them.
 *
 * An ability names its units in `unit_ids`; a unit names its abilities in
 * `ability_ids`. Against the surviving core units:
 *   - a `unit_ids` entry that is no core unit anywhere is stripped;
 *   - an ability whose `unit_ids` all went, and that no surviving unit in its
 *     faction dir lists (any unit anywhere, for the shared `_core` pool), is removed;
 *   - a `phase-mappings.json` entry for a removed ability is removed, unless another
 *     record in the same dir still carries that id.
 * An ability with no `unit_ids` (detachment rules, stratagems, enhancements) is never
 * touched here.
 *
 * Edits are spliced into each file's original text, so escape style and layout
 * survive (the tree mixes `\uXXXX` and literal UTF-8; see `scanAbilityRecordSpans`).
 */
import * as fs from "fs";
import * as path from "path";

import { scanAbilityRecordSpans } from "../backfill-source-digests.js";
import type { StagedWrite } from "./apply.js";
import { CORE_DIR, ENRICHMENT_DIR, readJsonArray } from "./repo-files.js";

interface AbilityRecord {
  ability_id?: string;
  id?: string;
  unit_ids?: string[];
}
interface PhaseMapping {
  source_id?: string;
  source_type?: string;
}

export interface AbilityPrune {
  dir: string;
  /** Ability ids removed from the dir's abilities.json. */
  removed: string[];
  /** `unit_ids` entries stripped from abilities that stay. */
  unitRefsStripped: number;
  phaseMappingsRemoved: number;
}

type Edit = { start: number; end: number; text: string };

function applyEdits(text: string, edits: Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Edits that delete the records at `drop` (indices into `spans`), with their separators. */
function removalEdits(text: string, spans: { start: number; end: number }[], drop: Set<number>): Edit[] {
  if (drop.size === spans.length) {
    return [{ start: text.indexOf("["), end: text.lastIndexOf("]") + 1, text: "[]" }];
  }
  const edits: Edit[] = [];
  // Delete each dropped record together with the separator before it; a dropped run at
  // the head takes the separator after it instead, up to the first kept record.
  const firstKept = spans.findIndex((_, i) => !drop.has(i));
  if (firstKept > 0) edits.push({ start: spans[0]!.start, end: spans[firstKept]!.start, text: "" });
  for (let i = firstKept + 1; i < spans.length; i++) {
    if (drop.has(i)) edits.push({ start: spans[i - 1]!.end, end: spans[i]!.end, text: "" });
  }
  // Adjacent dropped records produce touching edits; merge them so none overlap.
  edits.sort((a, b) => a.start - b.start);
  const merged: Edit[] = [];
  for (const e of edits) {
    const last = merged[merged.length - 1];
    if (last && e.start <= last.end) last.end = Math.max(last.end, e.end);
    else merged.push({ ...e });
  }
  return merged;
}

/** A string array as the file writes it: one item per line, indented under its key. */
function arrayText(items: string[], text: string, keyStart: number): string {
  if (!items.length) return "[]";
  const lineStart = text.lastIndexOf("\n", keyStart) + 1;
  const indent = text.slice(lineStart, keyStart);
  return `[\n${items.map((s) => `${indent}  ${JSON.stringify(s)}`).join(",\n")}\n${indent}]`;
}

function enrichmentDirs(root: string): string[] {
  return fs
    .readdirSync(root)
    .filter((d) => !d.startsWith("_example") && fs.statSync(path.join(root, d)).isDirectory())
    .sort();
}

/**
 * Plan the prune against `unitsByDir`, the core units that survive (by core dir).
 * Returns per-dir counts and the staged file texts; nothing is written here.
 */
export function pruneAbilities(
  unitsByDir: Map<string, { id: string; ability_ids?: string[] }[]>,
  enrichmentRoot = ENRICHMENT_DIR,
): {
  dirs: AbilityPrune[];
  staged: StagedWrite[];
} {
  const liveUnits = new Set<string>();
  const usedAnywhere = new Set<string>();
  for (const units of unitsByDir.values()) {
    for (const u of units) {
      liveUnits.add(u.id);
      for (const a of u.ability_ids ?? []) usedAnywhere.add(a);
    }
  }
  const dirs: AbilityPrune[] = [];
  const staged: StagedWrite[] = [];
  for (const dir of enrichmentDirs(enrichmentRoot)) {
    const file = path.join(enrichmentRoot, dir, "abilities.json");
    if (!fs.existsSync(file)) continue;
    const used =
      dir === "_core" ? usedAnywhere : new Set((unitsByDir.get(dir) ?? []).flatMap((u) => u.ability_ids ?? []));
    const text = fs.readFileSync(file, "utf8");
    const records = JSON.parse(text) as AbilityRecord[];
    const spans = scanAbilityRecordSpans(text);
    const res: AbilityPrune = { dir, removed: [], unitRefsStripped: 0, phaseMappingsRemoved: 0 };
    const drop = new Set<number>();
    const edits: Edit[] = [];
    records.forEach((a, i) => {
      const unitIds = a.unit_ids ?? [];
      if (!unitIds.length) return;
      const kept = unitIds.filter((u) => liveUnits.has(u));
      if (kept.length === unitIds.length) return;
      const id = a.ability_id ?? a.id ?? "";
      if (!kept.length && !used.has(id)) {
        drop.add(i);
        res.removed.push(id);
        return;
      }
      const member = spans[i]!.members.find((m) => m.key === "unit_ids")!;
      edits.push({ start: member.valueStart, end: member.valueEnd, text: arrayText(kept, text, member.keyStart) });
      res.unitRefsStripped += unitIds.length - kept.length;
    });
    if (!drop.size && !edits.length) continue;
    const newText = applyEdits(text, [...edits, ...removalEdits(text, spans, drop)]);
    staged.push({ path: file, value: JSON.parse(newText), text: newText });

    const mapFile = path.join(enrichmentRoot, dir, "phase-mappings.json");
    const survivors = new Set(
      records.filter((_, i) => !drop.has(i)).map((a) => a.ability_id ?? a.id),
    );
    const gone = new Set(res.removed.filter((id) => !survivors.has(id)));
    if (gone.size && fs.existsSync(mapFile)) {
      const mapText = fs.readFileSync(mapFile, "utf8");
      const mappings = readJsonArray<PhaseMapping>(mapFile);
      const mapDrop = new Set<number>();
      mappings.forEach((m, i) => {
        if (m.source_type === "ability" && m.source_id && gone.has(m.source_id)) mapDrop.add(i);
      });
      if (mapDrop.size) {
        const newMapText = applyEdits(mapText, removalEdits(mapText, scanAbilityRecordSpans(mapText), mapDrop));
        staged.push({ path: mapFile, value: JSON.parse(newMapText), text: newMapText });
        res.phaseMappingsRemoved = mapDrop.size;
      }
    }
    res.removed.sort();
    dirs.push(res);
  }
  return { dirs, staged };
}

/** The surviving core units by dir, read from disk (for a prune with no unit cull). */
export function coreUnitsByDir(): Map<string, { id: string; ability_ids?: string[] }[]> {
  const out = new Map<string, { id: string; ability_ids?: string[] }[]>();
  for (const dir of fs.readdirSync(CORE_DIR).sort()) {
    const file = path.join(CORE_DIR, dir, "units.json");
    if (fs.existsSync(file)) out.set(dir, readJsonArray(file));
  }
  return out;
}
