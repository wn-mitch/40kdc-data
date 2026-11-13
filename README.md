# 40kdc-data

[![Cross-impl parity](https://github.com/wn-mitch/40kdc-data/actions/workflows/parity.yml/badge.svg)](https://github.com/wn-mitch/40kdc-data/actions/workflows/parity.yml)
[![CI](https://github.com/wn-mitch/40kdc-data/actions/workflows/validate.yml/badge.svg)](https://github.com/wn-mitch/40kdc-data/actions/workflows/validate.yml)

> **Looking for 10th edition data?** The 10e dataset is preserved on branch [`10e-archive`](https://github.com/wn-mitch/40kdc-data/tree/10e-archive) and tagged [`10th/2025-q3`](https://github.com/wn-mitch/40kdc-data/releases/tag/10th/2025-q3). The `main` branch is migrating to **11th edition** — see [`11e-migration.md`](11e-migration.md) for status and the work plan.

Community-owned data schemas for Warhammer 40,000 developer tooling — **and** a linked, typed API over the dataset they describe.

## What This Is

Two things, both community-owned:

1. **The schema layer** for the [40kdc](https://40kdc.alpacasoft.dev) ecosystem — JSON Schemas that model 40K entities so tools can exchange data. Entity IDs are the interoperability contract.
2. **A ready-to-use dataset package.** The whole dataset ships embedded behind an intuitive, typed API: find a unit, then walk to its weapons, abilities, the phases those abilities act in, and its faction — no database, no network, no runtime filesystem access. Same ergonomics consumers expect, available today.

```ts
import { units } from "@alpaca-software/40kdc-data";

units.find("Kharn")!.abilities
  .filter(a => a.phases.includes("fight"))
  .map(a => a.id); // ["berzerker-frenzy-world-eaters", "legendary-killer-world-eaters"]
```

`find` is diacritic- and punctuation-insensitive — 40K is played globally, so `find("Kharn")` resolves "Khârn the Betrayer" and `find("Belakor")` resolves "Be'lakor". Full API reference: [`tools/docs/api/`](tools/docs/api/README.md).

The dataset is a view of one game mode. The default view is matched play: listings and name searches skip Combat Patrol-only units, detachments, enhancements, Stratagems and weapons, while lookups by id still resolve every record. `dataset.forGameMode("combat-patrol")` or `dataset.forGameMode("all")` opens another view (`for_game_mode` in Rust and Python, `ForGameMode` in Go).

## What This Is Not

This is not a database of source rules prose. Source prose is kept outside the
public dataset. The package contains structured mechanical representations,
generated descriptions, stat lines, and point costs.

## IP Stance

| Content | Included? | Rationale |
|---------|-----------|-----------|
| Stat lines (M, T, W, Sv, etc.) | Yes | Numerical facts |
| Point costs | Yes | Numerical facts |
| Weapon stats (A, S, AP, D) | Yes | Numerical facts |
| Source ability prose | **No** | Kept in private authoring inputs |
| Source rules prose | **No** | Kept outside the public dataset |
| Artwork / logos | **No** | Creative IP |

## Use It in NewRecruit or BattleScribe

Each release exports the dataset as a BSData-format game system and faction
catalogues, attached to the `bsdata-v<version>` releases
([all BSData releases](https://github.com/wn-mitch/40kdc-data/releases?q=bsdata)):

- **NewRecruit:** download `wh40k-11e-40kdc-<version>-newrecruit.zip` and
  unzip it. In NewRecruit, open **My Systems → Add more games** and upload the
  JSON files. Uploaded data stays on that device, so install it on each device
  you build lists on.
- **BattleScribe:** add
  `https://github.com/wn-mitch/40kdc-data/releases/download/bsdata-latest/index.bsi`
  as a data index URL, and BattleScribe updates from it with each release. The
  `-battlescribe.zip` on each release holds the same `.gst`/`.cat` files for a
  manual install. BattleScribe's format has no default selections, leader
  attachments or per-copy pricing, so NewRecruit gives the fuller experience.

Points and stat lines match the dataset. Ability text is 40kdc's own
plain-English descriptions, not the published rules wording.

## Quick Start

Use the dataset (TypeScript / JavaScript):

```bash
npm install @alpaca-software/40kdc-data
```

```ts
import { units, factions } from "@alpaca-software/40kdc-data";

const kharn = units.find("Kharn");
kharn?.faction?.id;            // "world-eaters"
kharn?.weapons.map(w => w.name);
factions.find("World Eaters")?.units.length;
```

See [`tools/README.md`](tools/README.md) for the full collection/link reference.

Validate data against schemas (the package also ships an AJV validator + CLI):

```bash
cd tools
npm install
npm run validate           # all data
npm run validate:core      # or just core / enrichment
npm run validate:enrichment
```

The package also ships a `40kdc-runner` binary that implements the
language-agnostic [conformance runner protocol](conformance/RUNNER_PROTOCOL.md):
NDJSON requests on stdin, NDJSON responses on stdout. The cross-implementation
parity differ uses this to compare every port against the same corpus. It is
not the recommended way to use the library — import the package directly for
that — but it is the supported entry point for cross-language verification.

## Schemas

### Core (structural entities)

| Schema | Description |
|--------|-------------|
| [faction](schemas/core/faction.schema.json) | Playable factions and sub-factions |
| [unit](schemas/core/unit.schema.json) | Unit datasheets with stat profiles and points |
| [weapon](schemas/core/weapon.schema.json) | Weapons with stat lines |
| [game-version](schemas/core/game-version.schema.json) | Edition and dataslate tracking |

### Enrichment (community-authored intelligence)

| Schema | Description |
|--------|-------------|
| [phase-mapping](schemas/enrichment/phase-mapping.schema.json) | Maps abilities to game phases |
| [interaction-flag](schemas/enrichment/interaction-flag.schema.json) | Ability conflicts, combos, sequencing |
| [ability](schemas/enrichment/ability-dsl/ability.schema.json) | Structured ability definitions (DSL) |

### Shared Definitions

| Schema | Description |
|--------|-------------|
| [common](schemas/$defs/common.schema.json) | Entity IDs, keywords, stat values |
| [game-version-ref](schemas/$defs/game-version-ref.schema.json) | Edition + dataslate reference |

## Ability DSL

40kdc builds community-authored structured game trees that express what abilities
do. A deterministic describer renders those trees for consumers; it does not
consult source prose. Records are authored through reviewed semantic leaves that
a deterministic compiler lowers to DSL; see
[`SEMANTIC_AUTHORING.md`](SEMANTIC_AUTHORING.md).

An ability entry composes four primitives:

- **Trigger**: when it activates (phase, timing, type)
- **Condition**: prerequisites (recursive AND/OR/NOT tree)
- **Effect**: what it does (stat modifiers, re-rolls, mortal wounds, etc.)
- **Scope**: targeting range and duration

Effects support composition: `choice` (pick one of N) and `sequence` (ordered steps).

See [schemas/enrichment/ability-dsl/](schemas/enrichment/ability-dsl/) and [data/enrichment/_example/abilities.example.json](data/enrichment/_example/abilities.example.json) for examples.

## Versioning

Everything is tagged to edition + dataslate (e.g., `11th/2026-10-14`). Dataslates that follow a Munitorum Field Manual release are named by that release's date. See [VERSIONING.md](VERSIONING.md).

## For Tool Developers

Multiple ways to consume this repo, depending on language and use case.

**The data package** — `npm install @alpaca-software/40kdc-data` for the embedded
dataset behind the linked typed API (above), plus the generated entity types and
an AJV validator. This is the fastest path for most tools.

**The schemas directly** — for non-JS toolchains or custom pipelines:

1. Add `40kdc-data` as a git submodule, or reference schema `$id` URLs
2. Point your JSON Schema validator (draft 2020-12) at `schemas/`
3. Use entity IDs from the 40kdc dataset for interoperability

### Rust

The [`wh40kdc`](crates/wh40kdc/) crate on crates.io mirrors the same surface:
serde-deserializable structs generated from these schemas (one flat module,
regenerated by `cargo run -p xtask -- codegen`), the embedded dataset behind a
linked `Dataset` API, the roster importers and exporters, share tokens, the
cruncher, the DSL/scoring describers, and a schema validator. With
`default-features = false` it is types-only.

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

The crate also embeds the schema as `wh40kdc::VALIDATION_SCHEMA` for downstream
validation, and ships a `wh40kdc-runner` binary used by the
cross-implementation parity differ — see [`CONFORMANCE.md`](CONFORMANCE.md).
Crate code is MIT; the schema content it describes is CC0. See
[`crates/wh40kdc/README.md`](crates/wh40kdc/README.md) for features and examples.

### Python

The [`wh40kdc`](python/) package on PyPI mirrors the TypeScript API surface:
Dataset linked queries, importers and exporters for all roster formats, the
damage-projection cruncher and attribution, the abilities resolver, scoring,
terrain geometry, the DSL/scoring describers, and a schema validator emitting
the shared closed-enum error codes.

```bash
pip install wh40kdc
```

```python
from wh40kdc import Dataset

ds = Dataset.embedded()
unit = ds.units.find("Khârn the Betrayer")
print([w.name for w in unit.weapons])
```

Entities are plain dicts (mirroring the JSON the schemas describe) behind
linked views; generated `TypedDict`s in `wh40kdc._types` provide static
typing. The only runtime dependency is `jsonschema`. The package also ships
the conformance runner (`python -m wh40kdc.runner`) used by the
cross-implementation parity differ — see [`CONFORMANCE.md`](CONFORMANCE.md).
Package code is MIT; the schema content it describes is CC0.

### Go

[![Go Reference](https://pkg.go.dev/badge/github.com/wn-mitch/40kdc-data/go.svg)](https://pkg.go.dev/github.com/wn-mitch/40kdc-data/go)

The [`wh40kdc`](go/) Go module mirrors the same surface — the embedded dataset
behind a linked `Dataset` API, all roster importers/exporters, the cruncher and
attribution, the abilities resolver, scoring, terrain geometry, the DSL/scoring
describers, and a schema validator emitting the shared closed-enum error codes.

```bash
go get github.com/wn-mitch/40kdc-data/go@latest
```

Records are modelled as plain `map[string]any` (mirroring the JSON the schemas
describe) behind linked views; the only external dependency is
`golang.org/x/text` (Unicode normalization for diacritic-insensitive lookup).
The module ships the conformance runner (`go/cmd/wh40kdc-runner`) used by the
cross-implementation parity differ — see [`CONFORMANCE.md`](CONFORMANCE.md).
Module code is MIT; the schema content it describes is CC0.

### R *(planned)*

An R package is planned, likely as an `extendr` wrapper around the Rust crate
rather than a native port (the Rust ecosystem handles cruncher numerics and JSON
parity more cleanly than R's idioms allow at the boundary). The decision is
pending a wrapper prototype; the [`CONFORMANCE.md`](CONFORMANCE.md) FAQ explains
the trade-off in more detail.

### Parity guarantee

All official ports — TypeScript, Rust, Python, and Go (R planned) —
are held in behavioral agreement by a shared conformance corpus in
[`conformance/`](conformance/). Within the documented tolerances (notably
`±5e-4` per cruncher stage; byte-equal export goldens otherwise), the same
inputs produce the same outputs in every language. See [`CONFORMANCE.md`](CONFORMANCE.md)
for what's pinned, the per-area invariants, and the contribution rules.

## Contributors and acknowledgements

40kdc-data is sustained by people who build its schemas, author and correct its
data, maintain its ports, and provide upstream community resources. Major,
long-running contributions include:

- [@wn-mitch](https://github.com/wn-mitch) — project creator and maintainer;
  schema and data architecture, ingestion and authoring systems, and the
  TypeScript, Rust, Python, and Go packages.
- **Oberyn ([@bmerrill17](https://github.com/bmerrill17))** — foundational
  project and data work; ability-authoring and ingestion infrastructure,
  canonical ability IDs, raw-text store tooling, detachment-rule
  reconciliation, and MFM synchronization.
- [@Cmnspro](https://github.com/Cmnspro) — ongoing roster-legality, wargear,
  ability-link, and faction-asset contributions.
- [@stopsign002](https://github.com/stopsign002) — repeated live-datasheet,
  points, wargear, and shared-unit corrections.
- [@superwutz](https://github.com/superwutz) and
  [Battlemaster](https://battlemaster.online) — structured terrain-layout data
  and its [public Data API](https://battlemaster.online/v1/public/docs#tag/data),
  used with permission.

Many other contributors have supplied data corrections, schema improvements,
tests, and tooling. GitHub's
[contributors page](https://github.com/wn-mitch/40kdc-data/graphs/contributors)
is the durable, complete record of accepted code contributions; issue reports,
reviews, and community research are valued even when they do not appear there.

## Licensing

| Directory | License |
|-----------|---------|
| `schemas/` | [CC0](LICENSE-SCHEMAS) (public domain) |
| `data/enrichment/` | [CC BY 4.0](LICENSE-DATA) (attribution required) |
| `tools/` | [MIT + attribution](LICENSE-TOOLS) (public deployments must credit) |

**Public deployment requirement:** Any publicly accessible application or service that ships `@alpaca-software/40kdc-data` as part of its end-user product must display a visible credit containing the text **"Powered by 40kdc-data"** and a link to <https://40kdc.alpacasoft.dev> in a user-accessible location (footer, about page, or credits section). Private use and library redistribution are exempt. Full terms: [`LICENSE-TOOLS`](LICENSE-TOOLS).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
