# wh40kdc

Python library for the [40kdc-data](https://github.com/wn-mitch/40kdc-data) Warhammer 40,000 dataset. It mirrors the TypeScript (`@alpaca-software/40kdc-data`), Rust (`wh40kdc`), and Go implementations, held in behavioral parity by the shared conformance corpus.

## Installation

```bash
pip install wh40kdc
```

The only runtime dependency is `jsonschema`.

## Quick Start

```python
from wh40kdc import Dataset

ds = Dataset.embedded()
unit = ds.units.find("Khârn the Betrayer")
for weapon in unit.weapons:
    print(weapon.name)
```

Records are plain dicts behind linked view objects, with generated `TypedDict` definitions in `wh40kdc._types` for static type checking.

## Features

- **Linked dataset API:** `Dataset` provides exact ID lookups, diacritic- and punctuation-insensitive name searches (`find`, `find_all`), reverse indexes, and joins across units, weapons, abilities, phases, and factions. `Dataset.embedded()` opens the **matched-play** view (skipping Combat Patrol-only records in listings and searches while resolving every ID); call `ds.for_game_mode("combat-patrol")` or `ds.for_game_mode("all")` for other views.
- **Roster importers:** ListForge, NewRecruit (JSON, `wtc-compact`, `wtc-full`, `simple`), GW app export, Rosterizer, and canonical Roster JSON, all normalizing to one `Roster` structure.
- **Roster exporters:** NewRecruit (JSON, `wtc-compact`, `wtc-full`, `simple`), canonical Roster JSON, Rosterizer, ATC 2026, and Yellowscribe — byte-identical to TypeScript, Rust, and Go.
- **Damage cruncher and attribution:** Deterministic expected-value pipeline (`attacks -> hits -> wounds -> unsaved -> damage -> after-fnp -> models-killed`) with buff resolution and leave-one-out attribution. Undecided leaf conditions are returned as needs with stable keys and answered via `conditionFacts` on the engine context. `Dataset.mortal_wound_sources_for` lists mortal wounds inflicted outside the attack sequence.
- **Scoring, terrain, and translation:** Mission scoring engine, terrain layout geometry and keystone measurements, and Ability-DSL / scoring-card English describers.
- **Schema validator:** `validate(target, value)` validates records against the canonical JSON Schemas and emits the shared closed-enum error codes.

The conformance runner used by the cross-implementation parity differ is invoked as `python -m wh40kdc.runner` (see `conformance/RUNNER_PROTOCOL.md`).

## Development

```bash
cd python
uv venv && uv pip install -e ".[dev]"
pytest          # unit tests + conformance suite when run inside the repo
ruff check .
mypy src
```

Generated artifacts (`_bundle.json`, `_spec.py`, `_types.py`, `src/wh40kdc/schemas/`) are checked in and verified for drift in CI. Regenerate them after schema or data changes:

```bash
python3 codegen/sync_bundle.py && python3 codegen/sync_spec.py && python3 codegen/gen_typeddicts.py
```

## License

- **Package code:** MIT.
- **Schemas:** CC0 (public domain).
- **Enrichment data:** CC BY 4.0 — see the repository's [licensing table](../README.md#licensing).
