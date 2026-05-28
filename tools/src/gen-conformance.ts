/**
 * Generate the cross-implementation conformance corpus under repo-root
 * `conformance/`. The TypeScript package is the reference implementation, so
 * the goldens it emits are what the Rust crate must reproduce byte-for-byte
 * (structurally). Run via `npm run gen:conformance`; CI regenerates and asserts
 * `git diff --exit-code conformance/` is clean.
 *
 * Outputs:
 * - `conformance/normalize.json` — `[{ input, expected }]` for normalizeName.
 * - `conformance/roster/<case>/expected.roster.json` — the resolved Roster.
 * - `conformance/roster/<case>/expected.<fmt>.{txt,json}` — every export
 *   target's golden output. The TS exporter is the oracle; the Rust mirror
 *   asserts byte-equal output for the same Roster.
 * - `conformance/roster/<case>/input.newrecruit-{wtc-compact,wtc-full,simple}.txt`
 *   — text inputs derived from the seed by the exporter, so a re-import
 *   regression in either implementation surfaces immediately.
 *
 * Seeding: each `<case>/` carries one canonical input — either the legacy
 * `input.json` (ListForge) or `input.newrecruit-json.json` (NewRecruit). Other
 * inputs are derived.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset } from "./data/dataset.js";
import { normalizeName } from "./data/normalize.js";
import { exportRoster, type ExportFormat } from "./export/index.js";
import { importRoster } from "./import/import-roster.js";
import type { Roster } from "./import/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");
const CONFORMANCE = join(REPO_ROOT, "conformance");

const NORMALIZE_INPUTS = [
  // NFD diacritic strip
  "Khârn the Betrayer",
  "Brôkhyr",
  "Ûthar",
  "Magnús",
  // apostrophe / quote variants
  "T'au",
  "Be’lakor",
  "Kor’sarro Khan",
  "Aetaos'rau'keres",
  "‘quoted’",
  // whitespace / hyphen collapse + trim
  "Brôkhyr Iron-master",
  "  the   betrayer  ",
  "space--marines",
  // casefold
  "KHÂRN THE BETRAYER",
  // already-normalized (idempotence)
  "kharn the betrayer",
  // distinctness anchors (must NOT collapse together)
  "Khorne",
  "Khârn",
];

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  writeFileSync(path, value);
}

function genNormalize(): void {
  const table = NORMALIZE_INPUTS.map((input) => ({ input, expected: normalizeName(input) }));
  writeJson(join(CONFORMANCE, "normalize.json"), table);
  console.log(`normalize.json: ${table.length} cases`);
}

/** Locate the canonical input for a fixture dir: prefer `input.json` (legacy
 * ListForge), fall back to `input.newrecruit-json.json` (NewRecruit). */
function seedRoster(caseDir: string, ds: Dataset): Roster {
  const candidates = ["input.json", "input.newrecruit-json.json"];
  for (const name of candidates) {
    const path = join(caseDir, name);
    if (existsSync(path)) {
      const decoded = JSON.parse(readFileSync(path, "utf8"));
      return importRoster(decoded, { dataset: ds });
    }
  }
  throw new Error(`no canonical input found in ${caseDir}`);
}

const TEXT_FORMATS: { format: ExportFormat; inputName: string; goldenName: string }[] = [
  {
    format: "newrecruit-wtc-compact",
    inputName: "input.newrecruit-wtc-compact.txt",
    goldenName: "expected.newrecruit-wtc-compact.txt",
  },
  {
    format: "newrecruit-wtc-full",
    inputName: "input.newrecruit-wtc-full.txt",
    goldenName: "expected.newrecruit-wtc-full.txt",
  },
  {
    format: "newrecruit-simple",
    inputName: "input.newrecruit-simple.txt",
    goldenName: "expected.newrecruit-simple.txt",
  },
];

function genRosters(): void {
  const ds = Dataset.embedded();
  const rosterDir = join(CONFORMANCE, "roster");
  for (const entry of readdirSync(rosterDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const caseDir = join(rosterDir, entry.name);

    const seed = seedRoster(caseDir, ds);
    writeJson(join(caseDir, "expected.roster.json"), seed);

    // JSON export golden — NewRecruit-shaped skeleton.
    const jsonOut = exportRoster(seed, "newrecruit-json");
    writeJson(join(caseDir, "expected.newrecruit-json.json"), JSON.parse(jsonOut));

    // Canonical Roster JSON export — should equal the resolved roster.
    writeJson(join(caseDir, "expected.roster-json.json"), JSON.parse(exportRoster(seed, "roster-json")));

    // Text exports: always write the export golden so the cross-implementation
    // byte-equality check has something to compare against. Only write the
    // `input.*.txt` round-trip seed when the fixture was authored for the
    // NewRecruit pipeline — legacy ListForge fixtures carry decoration
    // (multi-force warnings, leader-attachment inference) that the simple/wtc
    // exporters can't fully preserve, so the round-trip would fail
    // structurally rather than uncover a parser bug.
    const isNewRecruitSeed = existsSync(join(caseDir, "input.newrecruit-json.json"));
    for (const { format, inputName, goldenName } of TEXT_FORMATS) {
      const out = exportRoster(seed, format);
      writeText(join(caseDir, goldenName), out);
      if (isNewRecruitSeed) {
        writeText(join(caseDir, inputName), out);
      }
    }

    console.log(
      `roster/${entry.name}: ${seed.units.length} units, ${seed.diagnostics.warnings.length} warnings`,
    );
  }
}

genNormalize();
genRosters();
