# wh40kdc

The 40kdc Warhammer 40K dataset behind a linked, typed API — find units, follow
them to their weapons, abilities, phases, and factions. The Python counterpart
to [`@alpaca-software/40kdc-data`](https://www.npmjs.com/package/@alpaca-software/40kdc-data)
(npm) and [`wh40kdc`](https://crates.io/crates/wh40kdc) (crates.io), held in
behavioral lockstep with both by the shared conformance corpus in the
[40kdc-data repository](https://github.com/wn-mitch/40kdc-data).

```bash
pip install wh40kdc
```

```python
from wh40kdc import Dataset

ds = Dataset.embedded()
unit = ds.units.find("Khârn the Betrayer")
for weapon in unit.weapons:
    print(weapon.name)
```

What ships:

- **Linked dataset API** — `Dataset` with id/name lookups (diacritic- and
  punctuation-insensitive), reverse indexes, and join queries across units,
  weapons, abilities, phases, and factions.
- **Importers** — ListForge, NewRecruit (JSON / WTC-compact / WTC-full /
  simple), GW app export, and Rosterizer, all resolving to one `Roster` shape.
- **Exporters** — the same roster formats back out, byte-identical to the
  TypeScript and Rust implementations.
- **Cruncher** — the damage-projection engine (attacks → hits → wounds →
  unsaved → damage → after-FNP → models-killed) with buff resolution and
  per-buff attribution.
- **Scoring, terrain, translation** — secondary-mission scoring, terrain
  layout resolution and keystone measurements, and the ability-DSL /
  scoring-card describers.
- **Validator** — `validate(target, value)` against the canonical JSON
  Schemas, emitting the closed error-code enum shared by all implementations.

The conformance runner (used by the cross-implementation parity differ) is
invoked as `python -m wh40kdc.runner` — see `conformance/RUNNER_PROTOCOL.md`
in the repository.

## Development

```bash
cd python
uv venv && uv pip install -e ".[dev]"
pytest          # includes the conformance suite when run inside the repo
ruff check .
mypy src
```

Generated artifacts (`_bundle.json`, `_spec.py`, `_types.py`,
`src/wh40kdc/schemas/`) are produced by the scripts in `codegen/` and checked
for drift in CI — regenerate with:

```bash
python3 codegen/sync_bundle.py && python3 codegen/sync_spec.py && python3 codegen/gen_typeddicts.py
```

## License

MIT. The schema content the dataset describes is CC0; enrichment data is
CC BY 4.0 — see the repository's licensing table.
