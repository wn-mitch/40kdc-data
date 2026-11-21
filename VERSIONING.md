# Versioning

Records in this repository are versioned along two independent axes: **game version** (edition + dataslate) and **game mode**.

## Game Version (`game_version`)

Every core and enrichment entity carries a `game_version` object:

```json
{
  "edition": "11th",
  "dataslate": "2026-10-14"
}
```

- **`edition`:** The Warhammer 40,000 edition (`10th`, `11th`).
- **`dataslate`:** The balance or rules release the record reflects. All valid slates, effective dates, and supersession chains are registered in `data/core/game-versions.json`.
  - Slates matching a Munitorum Field Manual release use its release date (`2026-09-30`, `2026-10-14`), mapped from each dump's `data_version` in `tools/src/mfm/dataslate.ts`.
  - Other slates use kebab-case slugs (`pre-launch-provisional`, `launch`, `codex-orks`); the 10th-edition archive uses quarterly tags (`2025-q3`).

The `ingest-mfm dataslates` pass stamps records with the current dump's dataslate only when they match the dump; records that fail verification revert to `pre-launch-provisional`.

## Game Modes (`game_modes`)

Army-construction entities carry an optional `game_modes` array specifying which modes they belong to:

```json
{ "game_modes": ["combat-patrol"] }
```

- **Default:** An omitted `game_modes` field means `["matched-play"]`.
- **Allowed values:** Closed enum `game-mode-id` in `schemas/$defs/common.schema.json` (`matched-play`, `combat-patrol`, `boarding-actions`, `crusade`). Mode metadata (including `is_competitive`) is stored in `data/core/game-modes.json`.
- **Entities carrying `game_modes`:** `unit`, `detachment`, `enhancement`, `stratagem`, `weapon`, `unit-composition`, and `wargear-option`. Factions, missions, and registries do not carry it.
- **Derived stamps:** Stratagems inherit `game_modes` from their detachment, wargear options from their unit, and weapons from every unit that carries, can take, or equips them by default. Validation rejects stale stamps; run `cd tools && npm run stamp:game-modes -- --write` to re-derive them (MFM ingest writes re-derive them automatically).
- **Dataset views:** Each `Dataset` exposes one game mode (`matched-play` by default). Call `forGameMode("combat-patrol")` or `forGameMode("all")` (`for_game_mode` in Rust/Python, `ForGameMode` in Go) for another view. Exact ID lookups resolve across all modes so share tokens and saved rosters continue to resolve.

## Package Releases and Git Tags

- The 10th-edition dataset archive is tagged `10th/2025-q3`.
- All four language packages share one synchronized semantic version across `tools/package.json`, `crates/wh40kdc/Cargo.toml`, `python/src/wh40kdc/_version.py`, and `go/version.go` (enforced by CI).
- CI creates per-registry release tags: `npm-v{version}`, `wh40kdc-v{version}` (crates.io), `pypi-v{version}`, and `go/v{version}`.

## Data Directory Layout

Data is organized by faction rather than dataslate; individual records carry their own `game_version`:

```text
data/
├── core/
│   ├── game-versions.json
│   ├── game-modes.json
│   └── world-eaters/
│       ├── units.json
│       ├── weapons.json
│       └── ...
└── enrichment/
    └── world-eaters/
        ├── abilities.json
        └── phase-mappings.json
```

When a new dataslate arrives, an entry is added to `data/core/game-versions.json` and records advance as they are verified against the new source.

## Game Phases Across Editions

The five core game phases (`command`, `movement`, `shooting`, `charge`, `fight`) are shared across 10th and 11th edition in `schemas/$defs/common.schema.json`. Eleventh-edition Fight phase updates occur within the existing `fight` phase rather than introducing a new top-level phase.

## Schema Versioning

Schemas are versioned via git tags. Breaking schema changes increment the version segment in the schema `$id` URL (for example, `v2/core/faction.schema.json`); non-breaking additions keep the existing `$id`.

## Enrichment Entry Versioning

Ability DSL entries include `version` and `supersedes` fields. When an errata or FAQ changes an ability:

1. The prior entry remains for historical reference.
2. A new entry increments `version` and sets `supersedes` to the prior entry's ID.
3. Consumers resolve the chain for the target dataslate.
