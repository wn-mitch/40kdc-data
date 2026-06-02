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
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset } from "./data/dataset.js";
import { normalizeName } from "./data/normalize.js";
import { describeScoringCard } from "./translate/index.js";
import { exportRoster, type ExportFormat } from "./export/index.js";
import { importRoster, REGISTERED_ADAPTERS } from "./import/import-roster.js";
import { selectAdapter } from "./import/adapter.js";
import type { ParsedRoster, Roster } from "./import/types.js";
import { attributeStages } from "./cruncher/attribution.js";
import type { EngineInput } from "./cruncher/index.js";
import {
  resolveLayout,
  type TerrainTemplate as ResolverTemplate,
  type TerrainLayout as ResolverLayout,
} from "./terrain/resolve.js";

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
  // Unicode whitespace beyond ASCII — every Unicode whitespace must collapse
  // identically across implementations or `find("Khorne Lord")` and
  // `find("Khorne Lord")` will silently disagree across ports.
  "Khorne Lord",
  "Khorne　Lord",
  // Turkish dotted-I: NFD decomposes to `I` + combining dot above; the dot is
  // stripped, then locale-independent lowercase yields `i`. The case pins that
  // no implementation introduces locale-aware casefolding (which would map
  // `I` → `ı` under Turkish locale and break ASCII-text search).
  "İmperial Fists",
  // Zero-width joiner: passes through every step today. Pinned so behavior
  // does not silently change — if a future commit strips Cf-category chars,
  // this golden updates in the same PR.
  "Khorne‍Lord",
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
 * ListForge), then `input.newrecruit-json.json` (NewRecruit), then the
 * text-only `input.gw.txt` (GW app export — import-only, like ListForge). */
function seedRoster(caseDir: string, ds: Dataset): Roster {
  const decoded = decodeCanonicalSeed(caseDir);
  return importRoster(decoded, { dataset: ds });
}

/** Return the decoded payload for the canonical seed — the same value the
 * import pipeline would dispatch on. JSON seeds come back parsed; text seeds
 * come back as the raw string. */
function decodeCanonicalSeed(caseDir: string): unknown {
  const jsonSeed = join(caseDir, "input.json");
  if (existsSync(jsonSeed)) {
    return JSON.parse(readFileSync(jsonSeed, "utf8"));
  }
  const nrSeed = join(caseDir, "input.newrecruit-json.json");
  if (existsSync(nrSeed)) {
    return JSON.parse(readFileSync(nrSeed, "utf8"));
  }
  const gwSeed = join(caseDir, "input.gw.txt");
  if (existsSync(gwSeed)) {
    return readFileSync(gwSeed, "utf8");
  }
  throw new Error(`no canonical input found in ${caseDir}`);
}

/** Run a decoded payload through the adapter pipeline up to (but not past)
 * resolution. The result is the format-agnostic ParsedRoster — the same
 * intermediate the resolver consumes. Pinning this layer surfaces parser
 * regressions even when resolution masks them. */
function parsedFromCanonicalSeed(caseDir: string): ParsedRoster {
  const decoded = decodeCanonicalSeed(caseDir);
  const adapter = selectAdapter(decoded, [...REGISTERED_ADAPTERS]);
  return adapter.parse(decoded);
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

    // Parsed-stage golden — the intermediate ParsedRoster produced by the
    // adapter for the canonical seed, before resolution. Catches parser bugs
    // that resolution would otherwise mask (e.g. wrong unit count from a
    // duplicate cost line that resolves to the same unit twice).
    writeJson(join(caseDir, "expected.parsed.json"), parsedFromCanonicalSeed(caseDir));

    // JSON export golden — NewRecruit-shaped skeleton.
    const jsonOut = exportRoster(seed, "newrecruit-json");
    writeJson(join(caseDir, "expected.newrecruit-json.json"), JSON.parse(jsonOut));

    // Canonical Roster JSON export — should equal the resolved roster.
    writeJson(join(caseDir, "expected.roster-json.json"), JSON.parse(exportRoster(seed, "roster-json")));

    // Text exports: always write the export golden so every fixture exercises
    // the cross-implementation byte-equality check. Only write the
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

    // Rosterizer JSON export + a derived round-trip input. The exporter is
    // deterministic and round-trips through the adapter, so emitting it as
    // both `expected.rosterizer.json` and `input.rosterizer.json` pins the
    // cross-implementation goldens and the importer regression at the same
    // time. Same NewRecruit-seed gate as the text formats — multi-force
    // ListForge fixtures lose their provisional leader-attachment under
    // round-trip, so they only get the export golden, not the derived input.
    const rosterizerOut = exportRoster(seed, "rosterizer");
    writeJson(join(caseDir, "expected.rosterizer.json"), JSON.parse(rosterizerOut));
    if (isNewRecruitSeed) {
      writeJson(join(caseDir, "input.rosterizer.json"), JSON.parse(rosterizerOut));
    }

    console.log(
      `roster/${entry.name}: ${seed.units.length} units, ${seed.diagnostics.warnings.length} warnings`,
    );
  }
}

/**
 * Linked-API query cases. Each descriptor names a query method on Dataset, the
 * args to call it with, and how the result should be compared.
 *
 * `comparison: "ordered"` pins the result order — used for queries that iterate
 * a data-driven array (`unit.ability_ids`, `unit.weapon_ids`) where order is
 * encoded in the data and both implementations iterate it the same way.
 *
 * `comparison: "set"` pins only the set of ids — used for queries that walk an
 * index (faction → abilities, ability → phases) where iteration order depends
 * on dataset bundler internals and is incidental. Ids are sorted before
 * comparison.
 *
 * `comparison: "scalar"` pins a single id-or-null result (find_* and
 * faction_of(unit)).
 */
type LinkedApiQuery =
  | { name: string; query: "find_unit"; args: { query: string }; comparison: "scalar" }
  | { name: string; query: "find_weapon"; args: { query: string }; comparison: "scalar" }
  | { name: string; query: "find_faction"; args: { query: string }; comparison: "scalar" }
  | { name: string; query: "find_ability"; args: { query: string }; comparison: "scalar" }
  | { name: string; query: "abilities_of"; args: { unitId: string }; comparison: "ordered" }
  | { name: string; query: "weapons_of"; args: { unitId: string }; comparison: "ordered" }
  | { name: string; query: "phases_of"; args: { abilityId: string }; comparison: "set" }
  | { name: string; query: "faction_of"; args: { unitId: string }; comparison: "scalar" }
  | { name: string; query: "abilities_of_faction"; args: { factionId: string }; comparison: "set" }
  | { name: string; query: "weapons_of_faction"; args: { factionId: string }; comparison: "set" };

const LINKED_API_QUERIES: LinkedApiQuery[] = [
  // find_unit: diacritic-insensitive lookup, miss returns null.
  { name: "find_unit by diacritic name", query: "find_unit", args: { query: "Kharn" }, comparison: "scalar" },
  { name: "find_unit miss returns null", query: "find_unit", args: { query: "not-a-real-unit-xyz" }, comparison: "scalar" },
  // find_weapon: hyphen + space tolerance.
  { name: "find_weapon by name", query: "find_weapon", args: { query: "bolt rifle" }, comparison: "scalar" },
  // find_faction: punctuation/diacritic tolerance.
  { name: "find_faction by display name", query: "find_faction", args: { query: "World Eaters" }, comparison: "scalar" },
  // find_ability: ability name lookup.
  { name: "find_ability by name", query: "find_ability", args: { query: "Berzerker Frenzy" }, comparison: "scalar" },
  // abilities_of(unit): ordered, iterates unit.ability_ids array.
  { name: "abilities_of intercessor-squad", query: "abilities_of", args: { unitId: "intercessor-squad" }, comparison: "ordered" },
  { name: "abilities_of kharn-the-betrayer", query: "abilities_of", args: { unitId: "kharn-the-betrayer" }, comparison: "ordered" },
  // weapons_of(unit): ordered, iterates unit.weapon_ids array.
  { name: "weapons_of intercessor-squad", query: "weapons_of", args: { unitId: "intercessor-squad" }, comparison: "ordered" },
  { name: "weapons_of kharn-the-betrayer", query: "weapons_of", args: { unitId: "kharn-the-betrayer" }, comparison: "ordered" },
  // phases_of(ability): compared as set (phase index iteration order is incidental).
  { name: "phases_of berzerker-frenzy", query: "phases_of", args: { abilityId: "berzerker-frenzy" }, comparison: "set" },
  // faction_of(unit): scalar id or null.
  { name: "faction_of intercessor-squad", query: "faction_of", args: { unitId: "intercessor-squad" }, comparison: "scalar" },
  // abilities_of_faction: compared as set (collection-index order is incidental).
  { name: "abilities_of_faction world-eaters", query: "abilities_of_faction", args: { factionId: "world-eaters" }, comparison: "set" },
  // weapons_of_faction: compared as set.
  { name: "weapons_of_faction world-eaters", query: "weapons_of_faction", args: { factionId: "world-eaters" }, comparison: "set" },
];

function genLinkedApi(): void {
  const ds = Dataset.embedded();
  const cases = LINKED_API_QUERIES.map((q) => {
    const expected = runLinkedQuery(ds, q);
    return { ...q, expected };
  });
  writeJson(join(CONFORMANCE, "linked-api", "cases.json"), cases);
  console.log(`linked-api/cases.json: ${cases.length} cases`);
}

function runLinkedQuery(ds: Dataset, q: LinkedApiQuery): string | null | string[] {
  switch (q.query) {
    case "find_unit":
      return ds.units.find(q.args.query)?.id ?? null;
    case "find_weapon":
      return ds.weapons.find(q.args.query)?.id ?? null;
    case "find_faction":
      return ds.factions.find(q.args.query)?.id ?? null;
    case "find_ability":
      return ds.abilities.find(q.args.query)?.id ?? null;
    case "abilities_of": {
      const u = ds.units.get(q.args.unitId);
      if (!u) throw new Error(`abilities_of: unknown unit ${q.args.unitId}`);
      return u.abilities.map((a) => a.id);
    }
    case "weapons_of": {
      const u = ds.units.get(q.args.unitId);
      if (!u) throw new Error(`weapons_of: unknown unit ${q.args.unitId}`);
      return u.weapons.map((w) => w.id);
    }
    case "phases_of": {
      const a = ds.abilities.get(q.args.abilityId);
      if (!a) throw new Error(`phases_of: unknown ability ${q.args.abilityId}`);
      return [...a.phases].sort();
    }
    case "faction_of": {
      const u = ds.units.get(q.args.unitId);
      if (!u) throw new Error(`faction_of: unknown unit ${q.args.unitId}`);
      return u.faction?.id ?? null;
    }
    case "abilities_of_faction":
      return ds.abilities.byFaction(q.args.factionId).map((a) => a.id).sort();
    case "weapons_of_faction": {
      // Mirrors Rust `weapons_of_faction`: aggregate weapons across the
      // faction's units and dedupe by id. The collection-level
      // `weapons.byFaction()` is a different operation (it looks up weapons
      // whose own `faction_id` is set, which is empty for most factions).
      const f = ds.factions.get(q.args.factionId);
      if (!f) throw new Error(`weapons_of_faction: unknown faction ${q.args.factionId}`);
      return f.weapons.map((w) => w.id).sort();
    }
  }
}

/**
 * Attribution corpus: reuses the existing cruncher inputs from the cases that
 * carry at least one groupable buff (ability or manual). The expected shape
 * is the AttributedStage array produced by attributeStages; both
 * implementations of the leave-one-out decomposition must reproduce it
 * within the per-stage float tolerance.
 */
const ATTRIBUTION_CASE_FILES = [
  "05-anti-infantry-vs-cultist.json",
  "07-twin-linked-heavy-stationary-vs-knight.json",
];

interface CruncherCaseInput {
  name: string;
  attacker: { weaponId: string; profileIndex: number };
  modelsFiring: number;
  target: { unitId: string; profileIndex: number; modelCount?: number };
  context: EngineInput["context"];
  buffs: EngineInput["buffs"];
}

function loadAttributionInput(ds: Dataset, filename: string): {
  name: string;
  input: EngineInput;
} {
  const path = join(CONFORMANCE, "cruncher", filename);
  const c = JSON.parse(readFileSync(path, "utf8")) as CruncherCaseInput;
  const weapon = ds.weapons.get(c.attacker.weaponId);
  const unit = ds.units.get(c.target.unitId);
  if (!weapon) throw new Error(`attribution: unknown weapon ${c.attacker.weaponId}`);
  if (!unit) throw new Error(`attribution: unknown unit ${c.target.unitId}`);
  return {
    name: c.name,
    input: {
      attacker: { weapon: weapon.raw, profileIndex: c.attacker.profileIndex },
      target: {
        unit: unit.raw,
        profileIndex: c.target.profileIndex,
        ...(c.target.modelCount !== undefined ? { modelCount: c.target.modelCount } : {}),
      },
      modelsFiring: c.modelsFiring,
      buffs: c.buffs,
      context: c.context,
    },
  };
}

function genAttribution(): void {
  const ds = Dataset.embedded();
  const cases = ATTRIBUTION_CASE_FILES.map((filename, idx) => {
    const { name, input } = loadAttributionInput(ds, filename);
    const stages = attributeStages(input, ds);
    return {
      // Persist the input by file reference so the corpus stays a single
      // source of truth — the cruncher case file already pins the EngineInput.
      name,
      cruncher_case: filename,
      expected: stages.map((s) => ({
        name: s.name,
        expected: s.expected,
        baseline: s.baseline,
        lifts: s.lifts.map((l) => ({ source: l.source, delta: l.delta })),
        residual: s.residual,
        intrinsics: s.intrinsics,
      })),
      // Stable ordering of cases in the corpus file.
      _order: idx,
    };
  });
  // Sort by _order and strip the helper before writing.
  cases.sort((a, b) => a._order - b._order);
  const serialised = cases.map(({ _order: _o, ...rest }) => rest);
  writeJson(join(CONFORMANCE, "attribution", "cases.json"), serialised);
  console.log(`attribution/cases.json: ${cases.length} cases`);
}

/**
 * Scoring-card translation corpus: humanize each primary mission card's
 * `awards` into plain English. The TS translator is the oracle; the Rust port
 * must reproduce every string byte-for-byte (the differ compares structurally,
 * no tolerance). Only `card_type: "primary"` cards are pinned — the 14-card
 * secondary deck isn't revealed yet. Cases are sorted by id for stability, and
 * the `awards` array order within each card is load-bearing.
 */
function genScoringTranslation(): void {
  const ds = Dataset.embedded();
  mkdirSync(join(CONFORMANCE, "scoring-translation"), { recursive: true });
  const cases = ds.secondaryCards.all
    .filter((c) => c.card_type === "primary")
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((card) => ({ cardId: card.id, expected: { awards: describeScoringCard(card) } }));
  writeJson(join(CONFORMANCE, "scoring-translation", "cases.json"), cases);
  console.log(`scoring-translation/cases.json: ${cases.length} cases`);
}

/**
 * Terrain-resolver corpus: resolve template-anchored layouts to absolute
 * board-space vertices (y-down inches). The TS resolver is the oracle; the Rust
 * port must reproduce every vertex within 5e-4 (per-area invariant in
 * CONFORMANCE.md). Cases are self-contained — each carries its own `templates`
 * and `layout` — so the corpus does not depend on the bundled catalog and the
 * runner op can pass both in `args`. Coverage: per-template centroid anchoring
 * (identity), cardinal + oblique rotations, both mirror axes on an asymmetric
 * shape, embedded-feature composition, explicit parenting, and the inline
 * footprint escape hatch.
 */
function genTerrainResolver(): void {
  mkdirSync(join(CONFORMANCE, "terrain-resolver"), { recursive: true });

  const areaLarge: ResolverTemplate = {
    id: "area-large",
    name: "Large Area",
    kind: "area",
    footprint: { type: "rectangle", width: 11.5, height: 7 },
  };
  const areaMedium: ResolverTemplate = {
    id: "area-medium",
    name: "Medium Area",
    kind: "area",
    footprint: { type: "rectangle", width: 6, height: 4 },
  };
  const areaTrapezoid: ResolverTemplate = {
    id: "area-trapezoid",
    name: "Trapezoid Area",
    kind: "area",
    footprint: {
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 2, y: 11.5 },
        { x: 0, y: 11.5 },
      ],
    },
  };
  const wedge: ResolverTemplate = {
    id: "wedge",
    name: "Right Wedge",
    kind: "area",
    footprint: { type: "right-triangle", width: 8, height: 11.5 },
  };
  const wallLong: ResolverTemplate = {
    id: "wall-long",
    name: "Long Wall",
    kind: "feature",
    footprint: { type: "rectangle", width: 7, height: 0.25 },
  };
  const ruinComposed: ResolverTemplate = {
    id: "ruin-composed",
    name: "Composed Ruin",
    kind: "area",
    footprint: { type: "rectangle", width: 11.5, height: 7 },
    features: [
      { id: "back-wall", template: "wall-long", position: { x: 0, y: -3 } },
      { id: "side-wall", template: "wall-long", position: { x: -5, y: 0 }, rotation_degrees: 90, mirror: "horizontal" },
    ],
  };

  const baseCatalog = [areaLarge, areaMedium, areaTrapezoid, wedge, wallLong];

  const layoutCases: { name: string; templates: ResolverTemplate[]; layout: ResolverLayout }[] = [
    {
      name: "identity-large",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "area-large", position: { x: 30, y: 22 } }] },
    },
    {
      name: "identity-wedge",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "wedge", position: { x: 12, y: 30 } }] },
    },
    {
      name: "identity-trapezoid",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "area-trapezoid", position: { x: 40, y: 18 } }] },
    },
    {
      name: "rotate-medium-90",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "area-medium", position: { x: 30, y: 22 }, rotation_degrees: 90 }] },
    },
    {
      name: "rotate-medium-180",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "area-medium", position: { x: 30, y: 22 }, rotation_degrees: 180 }] },
    },
    {
      name: "rotate-medium-270",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "area-medium", position: { x: 30, y: 22 }, rotation_degrees: 270 }] },
    },
    {
      name: "rotate-large-oblique-55",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "area-large", position: { x: 30, y: 22 }, rotation_degrees: 55 }] },
    },
    {
      name: "rotate-trapezoid-oblique-235",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "area-trapezoid", position: { x: 35.75, y: 27 }, rotation_degrees: 235 }] },
    },
    {
      name: "mirror-trapezoid-horizontal",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "area-trapezoid", position: { x: 40, y: 18 }, mirror: "horizontal" }] },
    },
    {
      name: "mirror-trapezoid-vertical-rot90",
      templates: baseCatalog,
      layout: { id: "c", name: "c", pieces: [{ id: "p", template: "area-trapezoid", position: { x: 40, y: 18 }, rotation_degrees: 90, mirror: "vertical" }] },
    },
    {
      name: "composition-ruin-rot90-mirror-h",
      templates: [ruinComposed, wallLong],
      layout: { id: "c", name: "c", pieces: [{ id: "a1", template: "ruin-composed", position: { x: 30, y: 22 }, rotation_degrees: 90, mirror: "horizontal" }] },
    },
    {
      name: "explicit-parent-feature",
      templates: [areaLarge, wallLong],
      layout: {
        id: "c",
        name: "c",
        pieces: [
          { id: "a1", template: "area-large", position: { x: 30, y: 22 }, rotation_degrees: 90, mirror: "horizontal" },
          { id: "back-wall", template: "wall-long", parent_area_id: "a1", position: { x: 0, y: -3 } },
        ],
      },
    },
    {
      name: "inline-footprint-polygon",
      templates: [],
      layout: {
        id: "c",
        name: "c",
        pieces: [
          {
            id: "p",
            footprint: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 5 }] },
            position: { x: 50, y: 40 },
            rotation_degrees: 30,
          },
        ],
      },
    },
  ];

  const cases = layoutCases.map((c) => ({
    name: c.name,
    templates: c.templates,
    layout: c.layout,
    expected: { pieces: resolveLayout(c.layout, c.templates) },
  }));
  writeJson(join(CONFORMANCE, "terrain-resolver", "cases.json"), cases);
  console.log(`terrain-resolver/cases.json: ${cases.length} cases`);
}

genNormalize();
genRosters();
genLinkedApi();
genAttribution();
genScoringTranslation();
genTerrainResolver();
