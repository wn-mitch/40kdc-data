# wh40kdc

The Warhammer 40K dataset for the
[40kdc-data](https://github.com/Tabletop-Developer-Consortium/40kdc-data) schema
layer — the canonical community schema for 40K game entities. This crate is the
Rust counterpart of the `@alpaca-software/40kdc-data` npm package: it ships the
generated entity types, the **whole dataset embedded** behind a linked, typed
API, and a **ListForge army-list importer**.

Every type is generated from the project's JSON Schemas (JSON Schema draft
2020-12) via [`typify`](https://crates.io/crates/typify), so the Rust structs
stay in lockstep with the schemas that other consortium tools validate against.

## Data API (the headline)

With the default features, the entire dataset is embedded at build time behind a
linked accessor. Find an entity and follow it to its faction, weapons, abilities,
and the phases each ability acts in. Lookup is diacritic- and
punctuation-insensitive, so `"Kharn"` resolves "Khârn the Betrayer":

```rust
use wh40kdc::{Dataset, Phase};

let ds = Dataset::embedded();
let kharn = ds.find_unit("Kharn").unwrap();

let shooting: Vec<&str> = ds
    .abilities_of(kharn)
    .into_iter()
    .filter(|a| ds.phases_of(a).contains(&Phase::Shooting))
    .map(|a| a.ability_id.as_str())
    .collect();

assert_eq!(shooting, ["berzerker-frenzy"]);
assert_eq!(ds.faction_of(kharn).unwrap().id.as_str(), "world-eaters");
```

An ability's phases are **not** stored on the ability — they come from
phase-mappings, joined for you by [`Dataset::phases_of`]. Name matching is shared
with the npm package via the exported [`normalize_name`] (NFD diacritic strip,
casefold, quote/whitespace normalization).

## Army-list importer

The `import` feature turns a ListForge "share" export (URL, base64 segment, or
raw JSON) into a resolved 40kdc `Roster`, keyed on entity ids and validatable
against `roster.schema.json`. It reads only an allowlist of structural fields, so
it never carries reproduced rules text into its output.

```rust
use wh40kdc::Dataset;
use wh40kdc::import::import_listforge;

let roster = import_listforge(share_url, Dataset::embedded()).unwrap();
println!("{} of {} units resolved",
    roster.diagnostics.resolved_units, roster.units.len());
```

The importer is multi-format by design: `decode` and `resolve` are written once,
and each source format (ListForge today; New Recruit, Rosterizer, … next) is a
small `FormatAdapter` that lowers a payload to the shared `ParsedRoster`.

## Types-only usage

To consume just the generated types (no embedded data, no extra dependencies),
disable default features:

```toml
[dependencies]
wh40kdc = { version = "0.2", default-features = false }
serde_json = "1"
```

```rust
use wh40kdc::{Unit, Weapon};

let units: Vec<Unit> = serde_json::from_str(&units_json)?;
let weapons: Vec<Weapon> = serde_json::from_str(&weapons_json)?;
```

The bundled schema is available as a string for downstream validation:

```rust
let schema: serde_json::Value = serde_json::from_str(wh40kdc::BUNDLED_SCHEMA)?;
```

## Damage projection

The `cruncher` feature ships the Rust mirror of the npm package's expected-value
damage engine. Closed-form math over a flat `Buff` stack — no sampling, no I/O.
The cross-implementation [conformance corpus](../../conformance/cruncher/) pins
both engines to within `5e-4` per stage.

```rust
use wh40kdc::{Dataset, Phase};
use wh40kdc::cruncher::{crunch, AttackProfileRef, EngineContext, EngineInput, TargetProfileRef};

let ds = Dataset::embedded();
let weapon = ds.find_weapon("bolt-rifle").unwrap();
let target = ds.find_unit("intercessor-squad").unwrap();

let ctx = EngineContext {
    phase: Phase::Shooting,
    attacker_stationary: Some(false),
    attacker_charged: None,
    within_half_range: Some(false),
    attacker_in_cover: None,
    target_in_cover: None,
    attacker_keywords: None,
    target_keywords: None,
    timing: None,
    attacker_attached: None,
};
let out = crunch(&EngineInput {
    attacker: AttackProfileRef { weapon, profile_index: 0 },
    target: TargetProfileRef { unit: target, profile_index: 0, model_count: None },
    models_firing: 5,
    buffs: Vec::new(),
    context: ctx,
}, None).unwrap();
// out.stages: attacks → hits → wounds → unsaved → damage → after-fnp → models-killed
```

## Cargo features

- `bundled-data` *(default)* — the embedded dataset and the linked data API
  (`Dataset`, `Collection`, `normalize_name`).
- `import` *(default)* — the army-list importer (implies `bundled-data`).
- `export` *(default)* — the roster exporter (NewRecruit JSON / wtc-compact /
  wtc-full / simple / canonical Roster JSON / Rosterizer). Dataset-free.
- `cruncher` *(default)* — the expected-value damage engine (implies
  `bundled-data`).

Disable all four with `default-features = false` for a types-only build.

## Regenerating

Two artifacts are checked in. To regenerate after a change:

```sh
cd tools && npm run bundle:schemas   # rebuild crates/wh40kdc/schemas/bundled.schema.json
cargo run -p xtask -- codegen        # rewrite src/generated.rs from the schema
cargo run -p xtask -- bundle-data    # rewrite src/data/bundle.generated.json from data/
```

CI fails if the committed artifacts drift from the schemas or the data.

## Licensing

- The crate **code** is [MIT](../../LICENSE-TOOLS).
- The **schema** content these types describe is [CC0](../../LICENSE-SCHEMAS)
  (public domain).
- The **embedded dataset** mixes two licenses: the structural core data is CC0,
  and the community-authored enrichment data (abilities, phase-mappings, and the
  ability mechanics they encode) is **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**.
  If you redistribute the embedded data (e.g. by depending on this crate with the
  default `bundled-data` feature), attribute the **40kdc community**
  (Tabletop Developer Consortium). The types-only build
  (`default-features = false`) carries no data and so no attribution obligation.

This dataset is community-created and mirrors Games Workshop's datasheet
structure. Stat lines and points are numerical facts; no rules text or ability
prose is reproduced.
