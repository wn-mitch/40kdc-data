/**
 * Defensive-flag scrub: remove the stale `"defensive ability (skipped for damage
 * calc)"` `community_notes` marker from ability entries whose effect now
 * translates into real defender-side buffs.
 *
 * The marker was set when the cruncher couldn't read `damage-reduction`,
 * `invulnerable-save`, and `feel-no-pain {scope:"mortal"}`. With those landed
 * (#22), entries carrying valid DSL for those effects are no longer "skipped"
 * — leaving the flag in place would lie to downstream consumers (the SPA
 * surfaces it as "this is opaque to the engine").
 *
 * Decision per entry:
 *  - Walk the effect through `effectToBuffs(perspective:"target")` across
 *    every phase, with a permissive context (mirrors `audit-coverage.ts`).
 *  - If ANY phase yields `applied.length > 0`, the engine reads the ability
 *    today — strip the flag (delete `community_notes` outright if that was
 *    the only note; otherwise leave the field untouched, since we don't own
 *    other authored notes).
 *  - Otherwise leave the flag in place. Those are the genuine residue —
 *    `ability-grant`, `mortal-wounds`, the translator gap on
 *    `roll-modifier {target:"attacker"}`, etc. — for the follow-on grind.
 *
 * Idempotent: re-running is a no-op. The scrub only acts on the exact-match
 * sentinel string; refined notes from a future pass stay put.
 *
 * Usage: npx tsx tools/src/scrub-defensive-flag.ts            (writes in place)
 *        npx tsx tools/src/scrub-defensive-flag.ts --check     (report only)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { effectToBuffs } from "./cruncher/from-dsl.js";
import type { BuffSource, EngineContext } from "./cruncher/buffs.js";
import type { Phase } from "./generated.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ENRICHMENT_ROOT = resolve(__dirname, "../../data/enrichment");

/** The exact sentinel the audit pass historically wrote — only this string scrubs. */
export const STALE_FLAG = "defensive ability (skipped for damage calc)";

const PHASES: Phase[] = ["command", "movement", "shooting", "charge", "fight"];

interface AbilityEntry {
  ability_id?: string;
  ability_type?: string;
  effect?: unknown;
  community_notes?: string;
  [k: string]: unknown;
}

/**
 * Does this ability's effect produce any defender-side buff today? Mirrors the
 * audit-coverage walk: every phase, target perspective, permissive context.
 */
export function producesDefensiveBuff(entry: AbilityEntry): boolean {
  if (entry.effect === undefined) return false;
  const source = sourceFor(entry);
  for (const phase of PHASES) {
    const result = effectToBuffs(entry.effect, source, permissiveContext(phase), "target");
    if (result.applied.length > 0 || result.activatable.length > 0) return true;
  }
  return false;
}

/** Build a permissive context — every situational flag on. Matches audit-coverage. */
function permissiveContext(phase: Phase): EngineContext {
  return {
    phase,
    attackerStationary: true,
    attackerCharged: true,
    withinHalfRange: true,
    attackerInCover: true,
    targetInCover: true,
    attackerAttached: true,
    attackerKeywords: [],
    targetKeywords: [],
  };
}

/** Buff-source label for the walker. Kind is not load-bearing for this scrub. */
function sourceFor(entry: AbilityEntry): BuffSource {
  const kind =
    entry.ability_type === "faction"
      ? "army"
      : entry.ability_type === "detachment"
        ? "detachment"
        : entry.ability_type === "stratagem"
          ? "detachment-stratagem"
          : "unit";
  return { kind: "ability", abilityId: entry.ability_id ?? "?", abilityKind: kind };
}

/**
 * Strip the stale flag from one in-memory abilities array; return the number
 * of entries whose flag was cleared. The note field is deleted outright when
 * it held only the sentinel (the common case); other-note coexistence isn't
 * a thing in the current corpus (verified — every match is exact-equal).
 */
export function scrubDefensiveFlags(abilities: AbilityEntry[]): number {
  let changed = 0;
  for (const a of abilities) {
    if (a.community_notes !== STALE_FLAG) continue;
    if (!producesDefensiveBuff(a)) continue;
    delete a.community_notes;
    changed++;
  }
  return changed;
}

function run(check: boolean): void {
  let totalCleared = 0;
  let totalCarriesFlag = 0;
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

    const flagged = abilities.filter((a) => a.community_notes === STALE_FLAG);
    if (flagged.length === 0) continue;
    totalCarriesFlag += flagged.length;
    const clearable = flagged.filter((a) => producesDefensiveBuff(a)).length;
    if (clearable === 0) continue;

    if (check) {
      console.log(`  ${String(clearable).padStart(3)}/${String(flagged.length).padEnd(3)}  ${entry.name}`);
      totalCleared += clearable;
    } else {
      const cleared = scrubDefensiveFlags(abilities);
      writeFileSync(file, JSON.stringify(abilities, null, 2) + "\n");
      console.log(`  ✓ ${entry.name}: cleared ${cleared}/${flagged.length}`);
      totalCleared += cleared;
      filesTouched++;
    }
  }
  if (check) {
    if (totalCleared === 0) {
      console.log("No stale flags found that the engine now reads.");
    } else {
      console.log(`\n${totalCleared} of ${totalCarriesFlag} flagged entr${totalCarriesFlag === 1 ? "y" : "ies"} are now engine-readable; re-run without --check to clear.`);
      process.exit(1);
    }
  } else {
    console.log(`\nCleared ${totalCleared} of ${totalCarriesFlag} flagged entr${totalCarriesFlag === 1 ? "y" : "ies"} across ${filesTouched} file(s). Remaining flags are genuine engine-residue (translator gaps / non-buff effects).`);
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) run(process.argv.includes("--check"));
