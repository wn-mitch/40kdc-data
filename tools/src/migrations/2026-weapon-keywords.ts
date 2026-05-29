/**
 * One-shot migration to:
 *   1. Turn weapon-profile `keywords` strings into typed catalog references.
 *      Each `"Sustained Hits 1"` (and case variants) becomes
 *      `{ keyword_id: "sustained-hits", parameters: { value: 1 } }`.
 *      Strings whose pattern does not match any catalog entry are surfaced
 *      as diagnostics; the run leaves the original string untouched in that
 *      slot so a human can fix it before re-running.
 *
 *   2. Normalise every `type: "re-roll"` DSL effect's modifier so the dice
 *      subset is explicit:
 *        - `condition: "any-fail"` → `subset: "all-failures"`
 *        - `condition: "natural-1"` → `subset: "ones"`
 *        - no `condition` field      → `subset: "all-failures"`
 *      The `condition` field is removed in all cases; other modifier
 *      properties (`attack_type`, `uses`, `max_rerolls`, `context`, `roll`)
 *      are preserved.
 *
 * The script is idempotent: weapons already in the new shape (objects, not
 * strings) are left alone; re-roll modifiers with an explicit `subset` are
 * left alone.
 *
 * Run:
 *   npx tsx tools/src/migrations/2026-weapon-keywords.ts
 *
 * Outputs a final summary of `(file, keyword string, diagnostic)` tuples for
 * any unmatched keywords. Exit status is non-zero only if a JSON parse fails;
 * unmatched keywords are warnings, not errors, so the operator can iterate.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const CATALOG_PATH = join(REPO_ROOT, "data/core/weapon-keywords.json");
const DATA_ROOTS = [join(REPO_ROOT, "data/core"), join(REPO_ROOT, "data/enrichment")];

interface CatalogEntry {
  id: string;
  name: string;
  required_parameters: ("value" | "target_keyword" | "threshold")[];
}

type Diagnostic = { file: string; raw: string; reason: string };

/** Build the set of (display_name lower-cased → entry) lookups for the catalog. */
function loadCatalog(): { byName: Map<string, CatalogEntry>; ids: Set<string> } {
  const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf-8")) as CatalogEntry[];
  const byName = new Map<string, CatalogEntry>();
  const ids = new Set<string>();
  for (const entry of raw) {
    byName.set(entry.name.toLowerCase(), entry);
    ids.add(entry.id);
  }
  return { byName, ids };
}

interface KeywordRef {
  keyword_id: string;
  parameters?: { value?: number | string; target_keyword?: string; threshold?: number };
}

/** Title-case a multi-word string ("epic hero" → "Epic Hero"). */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Parse a single keyword string into a typed reference, or `null` when no
 * catalog entry matches. The function recognises the canonical 11e parameter
 * shapes:
 *
 *   - bare:                  `"Lethal Hits"` → `{ keyword_id: "lethal-hits" }`
 *   - value (number or dice): `"Sustained Hits D3"` → `{ ..., parameters: { value: "D3" } }`
 *   - anti-X N+:             `"Anti-INFANTRY 4+"` → `{ ..., parameters: { target_keyword: "INFANTRY", threshold: 4 } }`
 *
 * Returns `null` for unrecognised strings so the caller can surface them as a
 * diagnostic instead of silently dropping them.
 */
function parseKeywordString(
  raw: string,
  catalog: { byName: Map<string, CatalogEntry>; ids: Set<string> },
): KeywordRef | null {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // Anti-X N+ — special case: the target keyword and threshold are embedded.
  // Title-case the keyword to match unit-keyword data convention ("Infantry",
  // "Epic Hero" — never "INFANTRY" or "infantry").
  const antiMatch = /^anti-([a-z][a-z\s'-]*)\s+([2-6])\+$/i.exec(trimmed);
  if (antiMatch) {
    return {
      keyword_id: "anti",
      parameters: {
        target_keyword: titleCase(antiMatch[1]),
        threshold: Number(antiMatch[2]),
      },
    };
  }

  // Try each catalog entry's display name as a prefix; the suffix carries the
  // value parameter if the entry takes one.
  for (const [name, entry] of catalog.byName) {
    if (lower === name) {
      // Exact match — must be parameterless.
      if (entry.required_parameters.length === 0) {
        return { keyword_id: entry.id };
      }
      continue;
    }
    if (lower.startsWith(name + " ")) {
      const rest = trimmed.slice(name.length + 1).trim();
      if (entry.required_parameters.length === 1 && entry.required_parameters[0] === "value") {
        // Numeric (e.g. "5") or dice expression (e.g. "D3", "D6+3").
        const numericMatch = /^\d+$/.exec(rest);
        const diceMatch = /^\d*[Dd]\d+(\+\d+)?$/.exec(rest);
        if (numericMatch) {
          return { keyword_id: entry.id, parameters: { value: Number(rest) } };
        }
        if (diceMatch) {
          return { keyword_id: entry.id, parameters: { value: rest.toUpperCase() } };
        }
      }
    }
  }

  return null;
}

/**
 * Convert one weapon's `profiles[].keywords` array from legacy string form to
 * the new ref form, in place. Mutates `weapon`.
 */
function migrateWeapon(
  weapon: { profiles?: { keywords?: unknown }[] },
  catalog: { byName: Map<string, CatalogEntry>; ids: Set<string> },
  file: string,
  diagnostics: Diagnostic[],
): void {
  for (const profile of weapon.profiles ?? []) {
    const kws = profile.keywords;
    if (!Array.isArray(kws)) continue;
    const next: (KeywordRef | string)[] = [];
    for (const item of kws) {
      if (typeof item === "object" && item !== null && "keyword_id" in (item as object)) {
        // Already migrated.
        next.push(item as KeywordRef);
        continue;
      }
      if (typeof item !== "string") {
        diagnostics.push({ file, raw: String(item), reason: "non-string, non-object keyword entry" });
        next.push(item as unknown as string);
        continue;
      }
      const ref = parseKeywordString(item, catalog);
      if (ref) {
        next.push(ref);
      } else {
        diagnostics.push({ file, raw: item, reason: "no catalog entry matches" });
        // Keep the original string so the file still reads cleanly; a follow-up
        // pass can address it after the operator updates the catalog.
        next.push(item);
      }
    }
    profile.keywords = next;
  }
}

/** Normalise a `re-roll` modifier in place: condition → subset, drop condition. */
function migrateRerollModifier(mod: Record<string, unknown>): boolean {
  if (typeof mod.subset === "string") return false; // already migrated
  const cond = mod.condition;
  if (cond === "natural-1") mod.subset = "ones";
  else if (cond === "any-fail") mod.subset = "all-failures";
  // Some pre-migration data encoded "re-roll 1s" as `value: 1` rather than a
  // `condition`. Honor that signal before defaulting, or the intent is lost.
  else if (typeof mod.value === "number" && mod.value === 1) mod.subset = "ones";
  else mod.subset = "all-failures";
  if ("condition" in mod) delete mod.condition;
  return true;
}

/** Walk a JSON value and migrate any `type: "re-roll"` single-effect modifiers. */
function migrateRerollsIn(node: unknown): number {
  if (Array.isArray(node)) {
    let n = 0;
    for (const child of node) n += migrateRerollsIn(child);
    return n;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    let n = 0;
    if (obj.type === "re-roll" && obj.modifier && typeof obj.modifier === "object") {
      if (migrateRerollModifier(obj.modifier as Record<string, unknown>)) n += 1;
    }
    for (const value of Object.values(obj)) n += migrateRerollsIn(value);
    return n;
  }
  return 0;
}

function findJsonFiles(root: string, predicate: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findJsonFiles(full, predicate));
    } else if (entry.endsWith(".json") && predicate(entry)) {
      out.push(full);
    }
  }
  return out;
}

function writeJsonPreservingTrailingNewline(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function main(): void {
  const catalog = loadCatalog();
  const diagnostics: Diagnostic[] = [];
  let weaponFiles = 0;
  let rerollFiles = 0;
  let rerollEffects = 0;

  // 1. Weapons.
  for (const root of DATA_ROOTS) {
    for (const file of findJsonFiles(root, (n) => n === "weapons.json" || n === "weapons.example.json")) {
      const data = JSON.parse(readFileSync(file, "utf-8")) as unknown;
      if (!Array.isArray(data)) continue;
      for (const weapon of data) migrateWeapon(weapon, catalog, file, diagnostics);
      writeJsonPreservingTrailingNewline(file, data);
      weaponFiles += 1;
    }
  }

  // 2. Re-roll DSL effects — abilities + any other file that carries effect trees.
  for (const root of DATA_ROOTS) {
    for (const file of findJsonFiles(root, (n) => n.endsWith(".json") && n !== "weapons.json")) {
      const raw = readFileSync(file, "utf-8");
      const before = raw;
      const data = JSON.parse(raw) as unknown;
      const n = migrateRerollsIn(data);
      if (n > 0) {
        const after = JSON.stringify(data, null, 2) + "\n";
        if (after !== before) {
          writeFileSync(file, after);
          rerollFiles += 1;
          rerollEffects += n;
        }
      }
    }
  }

  console.log(`Weapon files rewritten: ${weaponFiles}`);
  console.log(`Re-roll effects normalised: ${rerollEffects} across ${rerollFiles} files`);
  if (diagnostics.length > 0) {
    console.log(`\nDiagnostics — ${diagnostics.length} unmatched keyword strings:`);
    for (const d of diagnostics.slice(0, 30)) {
      console.log(`  ${d.file.replace(REPO_ROOT + "/", "")}  ${JSON.stringify(d.raw)}  (${d.reason})`);
    }
    if (diagnostics.length > 30) console.log(`  ... and ${diagnostics.length - 30} more`);
  }
}

main();
