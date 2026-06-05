# CLAUDE.md

## Project Overview

40kdc-data is two things for the
[40kdc](https://40kdc.alpacasoft.dev) ecosystem:
(1) the shared **schema layer** — JSON Schema files that model Warhammer 40K game
entities plus community-authored enrichment data describing what abilities do
(without reproducing copyrighted text); and (2) a **data-distribution package**
(`@alpaca-software/40kdc-data`) that ships the whole dataset embedded behind a
linked, typed API — find a unit, follow it to its weapons, abilities, phases, and
faction. The package also re-exports the generated entity types and an AJV
validator (a secondary feature; the package's primary purpose is data access).

This is a community-created dataset that mirrors Games Workshop's datasheet
structure. Stat lines and point costs are numerical facts and are included.
Ability text, rules text, and artwork are never stored — the Ability DSL is a
community-authored structured representation of game mechanics.

## Repository Structure

```
schemas/
  $defs/            Shared definitions (entity-id, keyword, stat-value, phase, etc.)
  core/             Structural entity schemas:
                      faction, unit, weapon, game-version,
                      detachment, enhancement, stratagem,
                      wargear-option, leader-attachment, unit-composition
  enrichment/       Community-authored intelligence:
    ability-dsl/      Ability DSL (ability, trigger, condition, effect, scope)
    *.schema.json     Phase-mapping, timing-flag, interaction-flag
data/
  core/_example/    Fabricated example data (not real GW data)
  enrichment/       Community enrichment data by edition/dataslate
tools/              TypeScript package @alpaca-software/40kdc-data:
                      src/data/       Linked typed API (Dataset, collections, views)
                      src/codegen-data.ts  Bundles data/ into the embedded module
                      src/generated.ts     Entity types (codegen'd from schemas)
                      schema-loader/cli    AJV validator + 40kdc-validate CLI
                      docs/api/       Auto-generated API reference (TypeDoc)
```

## Schema Conventions

- JSON Schema draft 2020-12.
- `$id` values: `https://40kdc.dev/schemas/{path}/{name}.schema.json`.
- Entity IDs: kebab-case matching `^[a-z0-9][a-z0-9-]*[a-z0-9]$`.
- Cross-schema refs use `$ref` with relative paths to `$defs/`.
- Nullable fields: `oneOf: [{ ...type }, { type: "null" }]`.
- `additionalProperties: false` on all entity schemas.
- Data files are JSON arrays — each element is one entity.
- File naming: plural entity name (e.g., `factions.json`, `stratagems.json`).
- Game phases: `command`, `movement`, `shooting`, `charge`, `fight` (the 5
  official 10th edition phases — no "morale", no "pregame" at the core level).
- Every entity carries a `game_version` ref (edition + dataslate) for
  multi-edition support.

## IP Safety

- NEVER commit GW ability text, rules text, or artwork.
- Ability DSL entries must be community-authored mechanic descriptions.
- Stat lines and points values ARE permitted (numerical facts).
- Example data in `_example/` directories uses fabricated names only.
- FAQ references cite the document, not reproduce its text.

## Licensing

- `schemas/`: CC0 (public domain)
- `data/enrichment/`: CC BY 4.0 (attribution required)
- `tools/`: MIT

## Validation

```bash
cd tools
npm install
npm test           # unit tests (vitest)
npm run validate   # validate all data files against schemas
```

CI runs on every push and PR via `.github/workflows/validate.yml`.

## Cross-language parity

This repo holds the TypeScript, Rust, and Python implementations in parity through the `conformance/` corpus, and the same mechanism extends to the upcoming R port. Full strategy: [`CONFORMANCE.md`](CONFORMANCE.md). Contributor workflow: [`CONTRIBUTING.md`](CONTRIBUTING.md). Runner wire format: [`conformance/RUNNER_PROTOCOL.md`](conformance/RUNNER_PROTOCOL.md).

The load-bearing rule: **a new or changed golden in `conformance/` is not accepted until at least one implementation other than the one that produced it independently reproduces the same expected value.** A PR that touches the TS reference impl and the corpus in the same commit must also include the Rust (or Python, or R) test passing against the updated goldens. The same person can do both halves of the verification.

`conformance/SPEC_VERSION` (single integer) bumps for any semantic corpus change — new case, changed expected value, removed case, runner-protocol change, per-area invariant change. Pure formatting changes don't bump it. Each implementation embeds the version it was tested against.

When editing the corpus or changing behavior that the corpus pins, read the per-area invariants in `CONFORMANCE.md` first — several ordering and reduction-order details are deliberate contracts, not incidental output.

## Adding a New Schema

1. Create the schema file in `schemas/core/` or `schemas/enrichment/`.
2. Set `$id` following the URL convention.
3. Reference shared definitions from `schemas/$defs/common.schema.json`.
4. Add an example data file in `data/{core,enrichment}/_example/`.
5. Add the file-prefix → schema-id mapping in `tools/src/validate.ts` SCHEMA_MAP.
6. Add the `$id` expectation to `tools/test/schema-loader.test.ts`.
7. Add valid/invalid test fixtures to `tools/test/fixtures/`.
8. To expose the new entity in the data package, add it in three places:
   the `RawData` interface + `emptyRawData()` in `tools/src/data/types.ts`, the
   filename→collection mapping in `tools/src/codegen-data.ts`
   (`FILE_TO_COLLECTION`), and a `Collection`/array field in
   `tools/src/data/dataset.ts` (+ an export in `tools/src/data/index.ts`).
9. Run `npm test && npm run validate`.

## For Downstream Consumers

Tools can consume this repo via:
- npm dependency on `@alpaca-software/40kdc-data` (embedded dataset + linked
  typed API + ListForge and NewRecruit importers + roster exporters for the
  same five formats + generated types + validator) — the primary path for
  JS/TS tools
- the `wh40kdc` Rust crate (`crates/wh40kdc`) — the Rust counterpart:
  generated types, the same embedded dataset behind a `Dataset` linked API,
  the ListForge + NewRecruit (JSON / wtc-compact / wtc-full / simple)
  importers, and the matching roster exporters. Default features
  `bundled-data`/`import`/`export`; `default-features = false` drops to
  types-only, and `--features export` alone is decode-free (no
  `base64`/`flate2`/`regex`) for embedded targets. The Rust and TS
  implementations are pinned together by the shared `conformance/` corpus,
  including byte-identical export goldens.
- the `wh40kdc` Python package (`python/`, PyPI) — the Python counterpart:
  the same embedded dataset behind a `Dataset` linked API (plain dicts +
  generated TypedDicts), all importers/exporters, cruncher + attribution,
  abilities resolver, scoring, terrain, the DSL/scoring describers, and a
  `jsonschema`-based validator with the closed-enum codes. Only runtime dep
  is `jsonschema`; conformance-pinned with TS and Rust via the same corpus
  (runner: `python -m wh40kdc.runner`).
- Git submodule pointed at a tagged release (raw schemas + data)
- Direct `$id` URL references for JSON Schema validators

Entity IDs are the interoperability contract. If two tools use
`"space-marines"` as a faction ID, they can exchange data.

## Related Repositories

- **40kdc-editor**: Web-based UI for authoring enrichment data. Imports schemas
  from this repo for form validation. Changes here affect the editor's forms.
- **Project site**: https://40kdc.alpacasoft.dev

## Data Sources

- **army-assist** (`~/army-assist/src/assets/json/`): Normalized JSON extracted
  from community datasources. Used as source for mechanical data (stats, points,
  keywords, weapons). Contains UUID-based entity IDs. Shared units appear with
  per-faction "views" — select the view whose faction ability matches the target
  faction's faction rule. Run `npx tsx tools/src/convert-faction.ts <faction-id>`
  to regenerate core data from this source (e.g., `convert-faction.ts world-eaters`).

## Commit Style

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`.
- No scopes.
- Branch names: `wnmitch/<feature-name>`.
- JSON files: 2-space indentation.
