# wh40kdc

Rust library for the [40kdc-data](https://github.com/wn-mitch/40kdc-data) Warhammer 40,000 schema layer and dataset. It mirrors the `@alpaca-software/40kdc-data` npm package: generated serde types, the embedded dataset behind a linked `Dataset` API, roster importers and exporters, share tokens, the damage cruncher, the DSL/scoring describers, and a schema validator.

All entity types are generated from the project's JSON Schemas (draft 2020-12) via [`typify`](https://crates.io/crates/typify), keeping the Rust structs aligned with the validation schemas.

## Dataset API

With default features enabled, the full dataset is embedded at compile time behind a linked `Dataset` accessor. Name lookups ignore case, diacritics, and punctuation (`"Kharn"` matches `"Khârn the Betrayer"`):

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

assert_eq!(shooting, ["berzerker-frenzy-world-eaters"]);
assert_eq!(ds.faction_of(kharn).unwrap().id.as_str(), "world-eaters");
```

Ability phases are stored in phase mappings and joined by `Dataset::phases_of`. Name normalization is exported as `normalize_name` (NFD diacritic stripping, ASCII casefolding, and quote/dash/whitespace normalization).

`Dataset::embedded()` opens the **matched-play** view: listings and name lookups exclude records whose `game_modes` lack matched play (units, weapons, detachments, enhancements, stratagems, wargear options, and unit compositions), while exact ID lookups resolve every record. Call `ds.for_game_mode("combat-patrol")` or `ds.for_game_mode("all")` for another cached view (returns `Err(UnknownGameMode)` on unknown modes).

## Roster Import and Export

The `import` feature parses army lists into a resolved `Roster` keyed by entity IDs and validatable against `roster.schema.json`. Supported import formats: ListForge (share URL, base64 segment, JSON, or text), NewRecruit (JSON, `wtc-compact`, `wtc-full`, `simple`), GW app text export, Rosterizer, and canonical Roster JSON. Importers read only structural fields and never copy rules prose into the output. Lists using a Combat Patrol detachment resolve against the Combat Patrol view.

```rust
use wh40kdc::Dataset;
use wh40kdc::import::import_listforge;

let roster = import_listforge(share_url, Dataset::embedded()).unwrap();
println!(
    "{} of {} units resolved",
    roster.diagnostics.resolved_units,
    roster.units.len(),
);
```

`try_import_roster` detects the input format automatically and returns a typed failure if no adapter matches.

## Types-Only Usage

Disable default features to depend only on the generated types with no embedded data or extra dependencies:

```toml
[dependencies]
wh40kdc = { version = "1", default-features = false }
serde_json = "1"
```

```rust
use wh40kdc::{Unit, Weapon};

let units: Vec<Unit> = serde_json::from_str(&units_json)?;
let weapons: Vec<Weapon> = serde_json::from_str(&weapons_json)?;
```

The complete validation schema (including conditional rules) is embedded as `wh40kdc::VALIDATION_SCHEMA` (`BUNDLED_SCHEMA` is the codegen copy without conditional rules):

```rust
let schema: serde_json::Value = serde_json::from_str(wh40kdc::VALIDATION_SCHEMA)?;
```

## Damage Projection

The `cruncher` feature provides a deterministic, closed-form expected-value damage engine over a flat `Buff` stack (no Monte Carlo sampling, no I/O), pinned to within `5e-4` per stage against the TypeScript, Python, and Go ports via [`conformance/cruncher/`](../../conformance/cruncher/).

```rust
use wh40kdc::{Dataset, Phase};
use wh40kdc::cruncher::{crunch, AttackProfileRef, EngineContext, EngineInput, TargetProfileRef};

let ds = Dataset::embedded();
let weapon = ds.find_weapon("bolt-rifle").unwrap();
let target = ds.find_unit("intercessor-squad").unwrap();

let mut ctx = EngineContext::new(Phase::Shooting);
ctx.attacker_stationary = Some(false);
ctx.within_half_range = Some(false);
let out = crunch(&EngineInput {
    attacker: AttackProfileRef { weapon, profile_index: 0 },
    target: TargetProfileRef { unit: target, profile_index: 0, model_count: None },
    models_firing: 5,
    buffs: Vec::new(),
    context: ctx,
}, None).unwrap();
// Stages: attacks -> hits -> wounds -> unsaved -> damage -> after-fnp -> models-killed
```

- **Undecided conditions:** Populate `EngineContext.condition_facts` keyed by each `ConditionNeed::key` reported on unsupported fragments.
- **Out-of-attack mortal wounds:** `Dataset::mortal_wound_sources_for` returns mortal wounds inflicted outside the attack sequence with their timing moment and expected value before Feel No Pain.
- **Historical recipients and unit IDs:** Persistent event-selected recipients require caller-supplied `EngineContext.recipient_snapshots` along with `attacker_unit_id` or `target_unit_id`. Each `RecipientSnapshot` identifies the source ability, source unit, canonical trigger, selector/selection JSON pointer, perspective/unit, and selection verdict. Missing or conflicting evidence remains unsupported rather than inferred from current attachments. `unit_ids` filters match exact perspective-specific unit IDs.
- **Detached historical sources:** `Dataset::historical_snapshot_abilities` locates attested sources after detachment (verifying intrinsic ownership or legal enhancement eligibility) for passing to `Dataset::describe_buffs`.

## Cargo Features

| Feature | Default | Description |
|---------|---------|-------------|
| `bundled-data` | Yes | Embedded dataset and linked API (`Dataset`, `Collection`, `normalize_name`) |
| `import` | Yes | Army-list importers (implies `bundled-data`) |
| `export` | Yes | Roster exporters (NewRecruit JSON/`wtc-compact`/`wtc-full`/`simple`, Roster JSON, Rosterizer, ATC 2026 compact/full; dataset-free). Yellowscribe export requires `bundled-data` via `export_roster_with_dataset` |
| `cruncher` | Yes | Expected-value damage engine (implies `bundled-data`) |
| `share` | Yes | `share-v1` list token codec (`encode_share_token`, `decode_share_token`; embeds its own ID registry, no dataset) |
| `validate` | Yes | Schema validator (`validate_target`) over `VALIDATION_SCHEMA` emitting shared closed-enum error codes |

With `default-features = false`, the generated types, `translate` describers, `applies-to` scope matcher, terrain resolver, and scoring engine remain available.

## Regenerating Checked-In Artifacts

Generated files are committed and verified in CI. Regenerate them after schema or data edits:

```sh
cd tools && npm run bundle:schemas   # rebuild schemas/bundled.schema.json and schemas/validation.schema.json
cargo run -p xtask -- codegen        # rewrite src/generated.rs from the schema
cargo run -p xtask -- bundle-data    # rewrite src/data/bundle.generated.json and src/share/registry.generated.json
```

## Licensing

- **Crate code:** [MIT](../../LICENSE-TOOLS).
- **Schemas:** [CC0](../../LICENSE-SCHEMAS) (public domain).
- **Embedded dataset:** Structural core data is CC0; community-authored enrichment data (abilities, phase mappings, and structured mechanics) is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Redistributions including the `bundled-data` feature must attribute **Alpaca Software and the 40kdc community**. Types-only builds (`default-features = false`) carry no data and require no attribution.

Stat lines and points are numerical facts; no Games Workshop rules text or ability prose is included.
