/**
 * IP scrub: remove verbatim Games Workshop rules text from enrichment data.
 *
 * The original Haiku authoring pass, when it failed to translate a rule into
 * the ability DSL, left a stub and dumped the source GW `description` into
 * `community_notes` as `"… Original: <verbatim rules text>"`. CLAUDE.md forbids
 * committing GW ability text. This codemod replaces any such note with a
 * non-infringing citation, leaving genuinely-authored notes (analysis,
 * `"skipped for damage calc"`, etc.) untouched.
 *
 * Idempotent — re-running after a scrub is a no-op. Markers: `"Original:"` (the
 * dump prefix) and `"■"` (a GW bullet glyph that rides along with copied text).
 *
 * Usage: npx tsx tools/src/scrub-ip.ts            (writes in place)
 *        npx tsx tools/src/scrub-ip.ts --check     (report only, non-zero if leaks remain)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ENRICHMENT_ROOT = resolve(__dirname, "../../data/enrichment");

/** The note any GW-text-bearing entry is rewritten to. */
export const SCRUB_CITATION =
  "auto-generated stub — needs manual authoring (source: 10e Datasheets_abilities; rules text omitted for IP)";

/** Markers identifying a note that carries verbatim GW text. */
const LEAK_MARKER = /Original:|■/;

/** True when this note carries verbatim GW rules text and must be scrubbed. */
export function isLeak(note: string | undefined): boolean {
  return typeof note === "string" && LEAK_MARKER.test(note);
}

/** Replace a leaking note with the citation; pass authored notes through unchanged. */
export function scrubNote(note: string | undefined): string | undefined {
  return isLeak(note) ? SCRUB_CITATION : note;
}

interface AbilityEntry {
  community_notes?: string;
  [k: string]: unknown;
}

/** Scrub one file's array in place; return how many entries changed. */
export function scrubAbilities(abilities: AbilityEntry[]): number {
  let changed = 0;
  for (const a of abilities) {
    if (isLeak(a.community_notes)) {
      a.community_notes = SCRUB_CITATION;
      changed++;
    }
  }
  return changed;
}

function run(check: boolean): void {
  let totalLeaks = 0;
  let filesTouched = 0;
  for (const entry of readdirSync(ENRICHMENT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "_example") continue;
    const file = resolve(ENRICHMENT_ROOT, entry.name, "abilities.json");
    let abilities: AbilityEntry[];
    try {
      abilities = JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      continue;
    }
    if (!Array.isArray(abilities)) continue;
    const leaks = abilities.filter((a) => isLeak(a.community_notes)).length;
    if (leaks === 0) continue;
    totalLeaks += leaks;
    filesTouched++;
    if (check) {
      console.log(`  ${String(leaks).padStart(3)}  ${entry.name}`);
    } else {
      scrubAbilities(abilities);
      writeFileSync(file, JSON.stringify(abilities, null, 2) + "\n");
      console.log(`  ✓ ${entry.name}: scrubbed ${leaks}`);
    }
  }
  if (check) {
    console.log(totalLeaks === 0 ? "No GW-text leaks." : `\n${totalLeaks} leak(s) across ${filesTouched} file(s).`);
    if (totalLeaks > 0) process.exit(1);
  } else {
    console.log(`\nScrubbed ${totalLeaks} entr${totalLeaks === 1 ? "y" : "ies"} across ${filesTouched} file(s).`);
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) run(process.argv.includes("--check"));
