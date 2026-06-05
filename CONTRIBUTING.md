# Contributing

## Schema Changes

Schema changes affect all downstream tools. Before modifying a schema:

1. Open an issue using the **Schema Change** template
2. Describe the change and motivation
3. Note whether it's breaking (requires migration)
4. Wait for discussion before submitting a PR

## Enrichment Data

Enrichment data (phase mappings, timing flags, interaction flags, ability DSL entries) is this project's primary output.

1. Fork the repository
2. Add or update data files under `data/enrichment/`
3. Run `cd tools && npm run validate` to verify your data
4. Submit a PR with a clear description of what's covered

## Core Data

Core data files (stat lines, point costs, faction/unit/weapon definitions) live under `data/core/`.

**The canonical repository does not ship core data.** The `_example/` directory contains fabricated examples demonstrating the schema shape.

If you need core data for your tools:

1. Fork the repository
2. Populate `data/core/` in your fork
3. Run `cd tools && npm run validate:core` to verify
4. **Do not submit PRs with real core data back to this repository**

### Base sizes

`base_size_mm` on units (and per-model on `unit-compositions`) is populated by a
dedicated, additive converter — **not** by `convert-faction` (re-running that
regresses unrelated committed data). Sources, in priority order:

1. **GW Chapter Approved Tournament Companion — Base Size Guide** (authoritative for
   current matched-play units). Base sizes are numerical facts, so the extracted
   `name → size` rows are committed at `tools/src/converters/data/base-size-guide.json`.
   The **PDF itself is GW copyright and is never committed.**
2. **bevy-deploy-helper** (`../bevy-deploy-helper/assets/`) — fallback for the Forge
   World / Legends units the tournament guide omits.

To refresh from a newer guide revision (download the PDF locally first):

```bash
pdftotext -layout tournament-companion.pdf tc.txt
cd tools
tsx src/converters/base-size-guide-extract.ts tc.txt > src/converters/data/base-size-guide.json
tsx src/cli.ts populate-base-sizes   # patches data/core/*/{units,unit-compositions}.json
```

The populate step writes a report to `data/core/_reports/_base-sizes.unresolved.json`
listing unmatched units, bevy fallbacks, and unresolved models.

**Draft entries.** Categories the guide gives without standard millimetres
(`flying-base`, `hull`, `unique`) — and any non-authoritative value — are written
with `"draft": true`. These are placeholders to revisit: hand-author the real
dimensions in the relevant `units.json` / `unit-compositions.json` and drop the
`draft` flag. Find them with:

```bash
jq -r '.[] | select(.base_size_mm.draft) | .id' data/core/*/units.json
```

After editing schemas or data, regenerate downstream artifacts:
`npm run bundle:schemas && npm run codegen:types && npm run codegen:data`,
`cargo run -p xtask -- codegen`, `cargo run -p xtask -- bundle-data`. A base-size
change that touches conformance also bumps `conformance/SPEC_VERSION` and the
`tools/package.json` + `crates/wh40kdc/Cargo.toml` versions in lockstep.

## Tooling

The validation CLI lives under `tools/`. Standard PR workflow:

1. Fork and create a feature branch
2. Make changes, add tests
3. Run `npm test` and `npm run validate`
4. Submit a PR

## Cross-language parity

`40kdc-data` ships in multiple languages (TypeScript, Rust, and over time Python and R). Behavior is held in agreement by the `conformance/` corpus. The high-level strategy is in [`CONFORMANCE.md`](CONFORMANCE.md); the runner wire format is in [`conformance/RUNNER_PROTOCOL.md`](conformance/RUNNER_PROTOCOL.md).

**The load-bearing rule:**

> A new or changed golden in `conformance/` is not accepted until at least one implementation other than the one that produced it independently reproduces the same expected value.

This keeps the corpus from silently encoding any single implementation's quirks. The same person can do both halves of the verification — the rule is about evidence in the PR, not separation of duties.

**Workflow for a behavior change:**

1. Change the implementation in language X.
2. Regenerate (or hand-author) the affected goldens. For TS today: `cd tools && npm run gen:conformance`.
3. Run `just conformance-verify --impl <other-lang>` and confirm it passes against the updated goldens.
4. Include both the implementation diff *and* the corpus diff *and* the second-impl verification in the same PR.

**`SPEC_VERSION` bumps:**

- Bump `conformance/SPEC_VERSION` (single integer) when the corpus changes semantics: new case, changed expected value, removed case, runner-protocol change, per-area invariant change.
- Don't bump for pure formatting changes.

### Adding a language port

1. Implement the public-API surface inventoried in [`CONFORMANCE.md`](CONFORMANCE.md): Dataset linked queries, importers and exporters for all six formats, the cruncher, the validator (or a documented choice to omit one of these — but the omission needs to be deliberate, not accidental).
2. Ship a runner binary conforming to [`conformance/RUNNER_PROTOCOL.md`](conformance/RUNNER_PROTOCOL.md). The runner is a thin entry point into the public API; it doesn't introduce new logic.
3. Wire the runner into the cross-impl differ in `tooling/parity/` so CI can pair it against every other implementation.
4. Confirm every corpus case passes (`just conformance-verify --impl <your-lang>`) before opening the PR.
5. Add the port to the "For Tool Developers" section in `README.md` and the implementation-status table in `CONFORMANCE.md`.

### Python development

The Python package lives in `python/` (src layout, hatchling, `uv` workflow):

```bash
cd python
uv venv && uv pip install -e ".[dev]"
pytest            # unit tests + the full conformance suite (reads ../conformance/)
ruff check .
mypy src
```

Three generated artifacts are committed and drift-checked in CI — regenerate
after schema or data changes (the bundle comes from the Rust crate's
`bundle.generated.json`, the shared bundler whose file-walk order all three
implementations inherit):

```bash
cd tools && npm run bundle:schemas && cd ..
cargo run -p xtask -- bundle-data
python3 python/codegen/sync_bundle.py
python3 python/codegen/sync_spec.py
python3 python/codegen/gen_typeddicts.py
```

Cross-impl parity runs through the differ's pairings:

```bash
python3 tooling/parity/differ.py --pair ts,py
python3 tooling/parity/differ.py --pair rust,py
```

## Style

- JSON files: 2-space indent
- Entity IDs: kebab-case (`space-marines`, not `SpaceMarines`)
- One entity per array element in data files
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
