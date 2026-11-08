# Versioning

All data in this repository is versioned by **edition + dataslate**.

## Game Version Format

Every entity and enrichment entry carries a `game_version` object:

```json
{
  "edition": "11th",
  "dataslate": "2026-10-14"
}
```

- **edition**: The game edition (e.g., `10th`, `11th`)
- **dataslate**: The balance or rules update the record matches. The registry
  `data/core/game-versions.json` lists every dataslate with its effective date
  and the slate it supersedes. A slate that follows a Munitorum Field Manual
  release is named by that release's date (`2026-09-30`, `2026-10-14`), and
  `tools/src/mfm/dataslate.ts` maps each MFM dump `data_version` to its slate.
  Other slates use a kebab-case slug (`pre-launch-provisional`, `launch`,
  `codex-orks`), and the 10th-edition archive uses quarterly tags (`2025-q3`).

The `ingest-mfm dataslates` pass stamps a record with the current dump's slate
only when the record matches the dump. Records that claim a dump-confirmed slate but fail that
check fall back to `pre-launch-provisional`.

## Game Modes

Orthogonal to `game_version` (the *edition* axis), army-construction entities carry an optional **`game_modes`** array — the *mode* axis — naming the game mode(s) the entity is legal or authored for:

```json
{ "game_modes": ["combat-patrol"] }
```

- An **absent** `game_modes` means `["matched-play"]` (the competitive default), so every existing matched-play entity validates unchanged.
- The vocabulary is the closed enum `game-mode-id` in `schemas/$defs/common.schema.json`: `matched-play` (competitive) plus `combat-patrol`, `boarding-actions`, `crusade` (non-competitive). Per-mode metadata — notably `is_competitive` — lives in the registry `data/core/game-modes.json`, mirroring `game-versions.json` / `force-dispositions.json`.
- Only the army-construction entities carry it: `unit`, `detachment`, `enhancement`, `stratagem`, `weapon`, `unit-composition`, `wargear-option`. Faction / mission / registry entities do not.
- Stratagems, weapons and wargear options take their modes from the records that use them: a Stratagem from its detachment, a wargear option from its unit, and a weapon from every unit that carries it, can take it, or equips it by default. Validation fails when a stamp drifts; `npm run stamp:game-modes -- --write` (from `tools/`) re-derives them, and MFM ingest writes re-derive them before validating.
- The data packages read this axis as views. A `Dataset` lists one game mode, matched play by default; `forGameMode("combat-patrol" | "all")` opens another view. Id lookups resolve records outside the view, so share tokens and saved rosters keep resolving.
- The MFM completeness golden dimensions coverage by mode: the headline competitive number excludes non-matched-play content, and each non-competitive mode is tracked on its own dimension. Only `combat-patrol` is auto-detected from the dump (`publication.isCombatPatrol`); the rest are schema-homed for hand-authoring. See `11e-migration.md` § "Game modes axis" for the full rationale.

## Git Tags

The 10th-edition dataset is tagged `10th/2025-q3`.

Package releases carry one shared semantic version across the four packages
(`tools/package.json`, `crates/wh40kdc/Cargo.toml`,
`python/src/wh40kdc/_version.py`, `go/version.go`; CI fails on drift). CI tags
each release per registry: `npm-v{version}`, `wh40kdc-v{version}` (crates.io),
`pypi-v{version}`, and `go/v{version}`.

## Data File Organization

Data is organized by faction, not by dataslate. Each faction has a directory
under `data/core/` and `data/enrichment/`, and each record carries its own
`game_version`:

```
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

A new dataslate adds an entry to `game-versions.json`; records move to it as
they are checked against its source.

## Game Phases Across Editions

The five game phases (`command`, `movement`, `shooting`, `charge`, `fight`) are **shared between 10th and 11th edition** — the `phase` enum in `schemas/$defs/common.schema.json` is not edition-versioned. 11e's combat changes (the Pile In timing reorder, "Overrun Fight") happen *within* the Fight phase and do not introduce a new top-level phase, so no enum extension or per-edition split is required. If a future edition adds or removes a top-level phase, split `phase` into edition-scoped `$defs` at that point.

## Schema Versioning

Schemas are versioned via git tags. Breaking schema changes bump the version in the `$id` URL (e.g., `v2/core/faction.schema.json`). Non-breaking additions maintain the same `$id`.

## Enrichment Entry Versioning

Each ability DSL entry has its own `version` field and a `supersedes` field. When a FAQ changes a mechanic:

1. The old entry remains for historical reference
2. A new entry is created with the updated `version` and `supersedes` pointing to the old one
3. Tools resolve the chain to find the current version for a given dataslate
