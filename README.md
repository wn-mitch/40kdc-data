# 40kdc-data

[![Cross-impl parity](https://github.com/wn-mitch/40kdc-data/actions/workflows/parity.yml/badge.svg)](https://github.com/wn-mitch/40kdc-data/actions/workflows/parity.yml)
[![CI](https://github.com/wn-mitch/40kdc-data/actions/workflows/validate.yml/badge.svg)](https://github.com/wn-mitch/40kdc-data/actions/workflows/validate.yml)

> **Looking for 10th edition data?** The 10th edition dataset is preserved on the [`10e-archive`](https://github.com/wn-mitch/40kdc-data/tree/10e-archive) branch and tagged [`10th/2025-q3`](https://github.com/wn-mitch/40kdc-data/releases/tag/10th/2025-q3). The `main` branch targets **11th edition**.

Community-maintained JSON Schemas and an embedded Warhammer 40,000 dataset — plus roster import/export, legality checking, damage calculation, mission scoring, terrain geometry, and Ability-DSL descriptions — shipped in lockstep across TypeScript, Rust, Python, and Go.

## What's Included

- **Linked dataset API:** Units, weapons, factions, detachments, enhancements, stratagems, wargear options, unit compositions, missions, and terrain embedded in the package with no runtime database, network, or filesystem calls.
- **Ability DSL & English describer:** Structured JSON representations of game mechanics, a deterministic plain-English describer, and an eligibility resolver (`eligibleAbilities`, `stratagemCanTargetUnit`, `unitMatchesAppliesTo`).
- **Army-list pipeline:** Importers (ListForge, NewRecruit, GW app, Rosterizer, Roster JSON), 9 exporters (including WTC, ATC 2026, and Yellowscribe), army/wargear legality checking, and compact `share-v1` URL tokens.
- **Combat, scoring & terrain engines:** Closed-form expected-value damage cruncher, buff/lever resolution, leave-one-out attribution, exact wound allocation, mission VP scoring, and board-space terrain layout resolution.
- **BSData exports & JSON Schemas:** Ready-to-import NewRecruit and BattleScribe catalogues on every release, plus draft 2020-12 schemas and validators.

### Guides

- [Abilities, DSL, and Descriptions](docs/guides/abilities.md) — fetching abilities, rendering English text, resolving eligible rules, and Stratagem targeting
- [Army Lists, Legality, and Share Tokens](docs/guides/rosters.md) — importing/exporting lists, checking legality, and encoding `share-v1` URLs
- [Damage Projection (Crunching)](docs/guides/crunching.md) — `crunch`, DSL buff/lever resolution, `conditionFacts`, attribution, exact wound allocation, and out-of-attack mortal wounds
- [Mission Scoring, Terrain, and Validation](docs/guides/scoring-terrain-validation.md) — VP scoring, WTC bands, terrain layout geometry/keystones, and schema validation
- [TypeScript API Reference](tools/docs/api/README.md) — auto-generated TypeDoc reference

## Quick Examples (TypeScript)

```bash
npm install @alpaca-software/40kdc-data
```

### 1. Look up units, weapons, and generated ability descriptions

```ts
import { units } from "@alpaca-software/40kdc-data";

const kharn = units.find("Kharn")!; // diacritic- and punctuation-insensitive
console.log(kharn.faction?.id);     // "world-eaters"

for (const ability of kharn.abilities.filter(a => a.phases.includes("fight"))) {
  console.log(`${ability.name}: ${ability.describe()}`);
}
```

### 2. Import, validate, export, and share an army list

```ts
import {
  checkRoster,
  dataset,
  encodeShareToken,
  exportRoster,
  importRoster,
  rosterToShareList,
} from "@alpaca-software/40kdc-data";

const roster = importRoster(rawListTextOrJson, dataset);
const { legal, violations } = checkRoster(roster, dataset);
const wtcSummary = exportRoster(roster, "newrecruit-wtc-compact");
const shareUrlToken = encodeShareToken(rosterToShareList(roster));
```

### 3. Project expected damage

```ts
import { crunch, dataset, units, weapons } from "@alpaca-software/40kdc-data";

const out = crunch(
  {
    attacker: { weapon: weapons.find("Bolt Rifle")!.raw, profileIndex: 0 },
    target: { unit: units.find("Intercessor Squad")!.raw, profileIndex: 0 },
    modelsFiring: 5,
    buffs: [],
    context: { phase: "shooting", attackerStationary: false, withinHalfRange: false },
  },
  dataset,
);
// out.stages: attacks -> hits -> wounds -> unsaved -> damage -> after-fnp -> models-killed
```

### Game Modes

A `Dataset` represents one game-mode view. The default embedded view is **matched play**: listings and name searches exclude Combat Patrol-only units, detachments, enhancements, stratagems, weapons, wargear options, and unit compositions, while exact ID lookups resolve every record so saved rosters and share tokens continue to decode. Call `dataset.forGameMode("combat-patrol")` or `dataset.forGameMode("all")` (`for_game_mode` in Rust and Python, `ForGameMode` in Go) for another view.

## Scope and IP Policy

This repository does not store Games Workshop rules text, ability prose, lore, or artwork. Public data is restricted to numerical facts (stat lines, point costs, weapon profiles) and community-authored structured mechanics (the Ability DSL) rendered by a deterministic English describer.

| Content | Included | Basis |
|---------|----------|-------|
| Stat lines (`M`, `T`, `W`, `Sv`, etc.) | Yes | Numerical facts |
| Point costs | Yes | Numerical facts |
| Weapon profiles (`A`, `S`, `AP`, `D`) | Yes | Numerical facts |
| Source ability or rules prose | **No** | Excluded from the public dataset |
| Artwork and logos | **No** | Excluded from the public dataset |

## Using the Data in NewRecruit, ListForge, and BattleScribe

Each release exports the 11th edition dataset in [BSData](https://github.com/BSData) format (a `.gst` game system file and per-faction `.cat` catalogues) under `bsdata-v<version>` releases ([all BSData releases](https://github.com/wn-mitch/40kdc-data/releases?q=bsdata)):

- **NewRecruit:** Download `wh40k-11e-40kdc-<version>-newrecruit.zip` from the latest `bsdata-v<version>` release, unzip it, open **My Systems -> Add more games**, and upload all JSON files. Data is stored per device; repeat the upload to update.
- **ListForge:** In ListForge's game-system / data-source settings, add `https://github.com/wn-mitch/40kdc-data/releases/download/bsdata-latest/index.bsi` as a custom BSData index URL to track the latest export, or import the `.gst` and `.cat` files manually from `wh40k-11e-40kdc-battlescribe.zip` (also committed under [`bsdata/xml/`](bsdata/xml)).
- **BattleScribe:** Add `https://github.com/wn-mitch/40kdc-data/releases/download/bsdata-latest/index.bsi` as a data index URL to track the latest export automatically. For manual installation, use `wh40k-11e-40kdc-<version>-battlescribe.zip` (`.gst` and `.cat` XML files).
- **Direct archive URLs:** The `bsdata-latest` release publishes fixed-name archives at `https://github.com/wn-mitch/40kdc-data/releases/download/bsdata-latest/<file>` for `wh40k-11e-40kdc-newrecruit.zip` (JSON) and `wh40k-11e-40kdc-battlescribe.zip` (XML).
- **Loading directly from GitHub:** The same files are committed on `main` under [`bsdata/json/`](bsdata/json) and [`bsdata/xml/`](bsdata/xml). List them via `https://api.github.com/repos/wn-mitch/40kdc-data/contents/bsdata/json?ref=main` and fetch individual files from `https://raw.githubusercontent.com/wn-mitch/40kdc-data/main/bsdata/json/<file>`.

BattleScribe's file format has three limitations that NewRecruit does not share:

- **Default starting models:** NewRecruit initializes units with their default model counts; BattleScribe starts each model type at its minimum count.
- **Leader attachments:** BattleScribe does not validate leader-to-bodyguard attachment eligibility.
- **Ordinal unit pricing:** BattleScribe prices every copy of a repeated unit at the first copy's cost; NewRecruit applies escalating per-copy costs.

BSData exports contain the same stat lines and points as the language packages, with ability descriptions generated from the Ability DSL rather than published rules text.

## Language Packages

All four official packages expose the same dataset and engines, verified against the shared [`conformance/`](conformance/) corpus (`±5e-4` per cruncher stage; exact equality on text exports, validation codes, scoring, and share tokens).

### TypeScript / JavaScript

Package: [`@alpaca-software/40kdc-data`](tools/README.md) (Node 20+, bundlers, browsers). See [`tools/README.md`](tools/README.md) and the guides above.

To validate repository data locally:

```bash
cd tools
npm install
npm run validate            # validate core + enrichment data
npm run validate:core
npm run validate:enrichment
```

The package also ships `40kdc-runner` implementing the NDJSON [conformance runner protocol](conformance/RUNNER_PROTOCOL.md) for cross-language parity verification.

### Rust

The [`wh40kdc`](crates/wh40kdc/README.md) crate provides generated serde types, the embedded `Dataset` API, roster importers and exporters, share tokens, the damage cruncher, DSL/scoring describers, and a schema validator. Disable default features (`default-features = false`) for a types-only build.

```toml
[dependencies]
wh40kdc = "1"
```

```rust
use wh40kdc::Dataset;

let ds = Dataset::embedded();
let kharn = ds.find_unit("Kharn").unwrap();
assert_eq!(ds.faction_of(kharn).unwrap().id.as_str(), "world-eaters");
```

### Python

The [`wh40kdc`](python/README.md) package mirrors the TypeScript API over plain dicts with generated `TypedDict` types in `wh40kdc._types`. The only runtime dependency is `jsonschema`.

```bash
pip install wh40kdc
```

```python
from wh40kdc import Dataset

ds = Dataset.embedded()
unit = ds.units.find("Khârn the Betrayer")
print([w.name for w in unit.weapons])
```

### Go

[![Go Reference](https://pkg.go.dev/badge/github.com/wn-mitch/40kdc-data/go.svg)](https://pkg.go.dev/github.com/wn-mitch/40kdc-data/go)

The [`wh40kdc`](go/) Go module mirrors the same API over `map[string]any` records behind linked views. Its only external dependency is `golang.org/x/text` for Unicode name normalization, and it ships the conformance runner at `go/cmd/wh40kdc-runner`.

```bash
go get github.com/wn-mitch/40kdc-data/go@latest
```

### Direct Schema Usage

For other languages or custom pipelines:

1. Add `40kdc-data` as a git submodule or reference the schema `$id` URLs.
2. Point a JSON Schema draft 2020-12 validator at `schemas/`.
3. Exchange records using the canonical kebab-case entity IDs.

An R binding (likely via an `extendr` wrapper around the Rust crate) is planned; see [`CONFORMANCE.md`](CONFORMANCE.md).

## Schemas

| Group | Schemas |
|-------|---------|
| **Core** | [faction](schemas/core/faction.schema.json), [unit](schemas/core/unit.schema.json), [weapon](schemas/core/weapon.schema.json), [game-version](schemas/core/game-version.schema.json), plus detachments, enhancements, stratagems, wargear options, unit compositions, leader attachments, missions, terrain, and rosters in [`schemas/core/`](schemas/core/) |
| **Enrichment** | [ability](schemas/enrichment/ability-dsl/ability.schema.json) (Ability DSL), [phase-mapping](schemas/enrichment/phase-mapping.schema.json), [interaction-flag](schemas/enrichment/interaction-flag.schema.json) in [`schemas/enrichment/`](schemas/enrichment/) |
| **Shared `$defs`** | [common](schemas/$defs/common.schema.json), [game-version-ref](schemas/$defs/game-version-ref.schema.json) |

## Versioning

Records are tagged with an edition and dataslate (for example, `11th/2026-10-14`). Dataslates following a Munitorum Field Manual update are named by release date. See [`VERSIONING.md`](VERSIONING.md).

## Contributors and Acknowledgements

Major ongoing contributions include:

- [@wn-mitch](https://github.com/wn-mitch) — creator and maintainer; schema and data architecture, ingestion and authoring pipelines, and the TypeScript, Rust, Python, and Go packages.
- **Clemens Probst ([@Cmnspro](https://github.com/Cmnspro))** — terrain layout keystones, roster legality, allied points pricing, wargear and ability DSL authoring, faction assets, and cross-language conformance work.
- **Oberyn ([@bmerrill17](https://github.com/bmerrill17))** — foundational data and authoring work, canonical ability IDs, detachment-rule reconciliation, and MFM synchronization.
- **David Trimoulet ([@DavidTrimoulet](https://github.com/DavidTrimoulet))** — ability DSL authoring, leader attachment parsing, and MFM/detachment fixes.
- **Margus Niitsoo ([@velochy](https://github.com/velochy))** — Ability DSL schema refinements, condition validation, source-digest provenance, and name-normalization performance.
- [@stopsign002](https://github.com/stopsign002) — datasheet, points, wargear, and shared-unit corrections.
- [@superwutz](https://github.com/superwutz) and [Battlemaster](https://battlemaster.online) — structured terrain-layout data via its [public Data API](https://battlemaster.online/v1/public/docs#tag/data), used with permission.

See the GitHub [contributors page](https://github.com/wn-mitch/40kdc-data/graphs/contributors) for the complete contribution history.

## Licensing

| Directory | License |
|-----------|---------|
| `schemas/` | [CC0](LICENSE-SCHEMAS) (public domain) |
| `data/enrichment/` | [CC BY 4.0](LICENSE-DATA) (attribution required) |
| `tools/` | [MIT + attribution](LICENSE-TOOLS) (public deployments must credit) |

**Public deployment attribution:** Any publicly accessible application or service shipping `@alpaca-software/40kdc-data` must display a visible credit reading **"Powered by 40kdc-data"** with a link to <https://40kdc.alpacasoft.dev> in a user-accessible location (footer, about page, or credits). Private use and library redistribution are exempt. See [`LICENSE-TOOLS`](LICENSE-TOOLS) for full terms.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).
