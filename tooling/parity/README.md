# Cross-implementation parity differ

A stdlib-only Python script that drives two NDJSON runners against the
conformance corpus at `conformance/` and asserts byte- or tolerance-equal
responses. Four runners exist: TypeScript, Rust, Python, and Go; `--pair`
selects which two run (TypeScript and Rust by default). The runners speak the
wire protocol in
[`conformance/RUNNER_PROTOCOL.md`](../../conformance/RUNNER_PROTOCOL.md); every
implementation embeds the corpus `SPEC_VERSION` and refuses to participate on
mismatch.

Per-language conformance tests in `tools/test/conformance.test.ts`,
`crates/wh40kdc/tests/*.rs`, `python/tests/conformance/` and
`go/conformance_test.go` continue to verify each impl against the goldens.
The differ is the **additional** gate that catches *co-drift* — two impls
agreeing with a regenerated golden that's actually wrong, or both following
the curated corpus but disagreeing on inputs nobody wrote down.

## Quick start

From the repo root:

```bash
# 1. Build the runners (the differ falls back to running from source when a
#    pre-built artifact is missing).
cd tools && npm ci && npm run build && cd ..
cargo build --release --bin wh40kdc-runner
(cd go && go build -o wh40kdc-runner ./cmd/wh40kdc-runner)

# 2. Corpus parity — runs every case in every area for one pairing.
#    Exits 0 iff every case agrees.
python3 tooling/parity/differ.py                 # ts,rust
python3 tooling/parity/differ.py --pair ts,py
python3 tooling/parity/differ.py --pair rust,go

# 3. Property-style fuzzing — deterministic random inputs both impls have to
#    agree on. Mismatches dump full reproducers into regressions/.
python3 tooling/parity/differ.py --mode fuzz --fuzz-target normalize --fuzz-seed 42
python3 tooling/parity/differ.py --mode fuzz --fuzz-target crunch     --fuzz-seed 42
```

## Auto-detection

- `--ts-cmd` defaults to `node tools/dist/runner.js` if the built artifact
  exists, otherwise `npx tsx tools/src/runner.ts`.
- `--rust-cmd` defaults to `target/release/wh40kdc-runner`, then the debug
  build, and finally `cargo run --quiet --release --bin wh40kdc-runner`.
- `--py-cmd` defaults to `python -m wh40kdc.runner` with `python/src` on
  `PYTHONPATH`, using `python/.venv` when present (the interpreter needs
  `jsonschema`).
- `--go-cmd` defaults to `go/wh40kdc-runner` if built, otherwise
  `go run -C go ./cmd/wh40kdc-runner`.

The same invocation works locally (running from source) and in CI (running
from pre-built artifacts) with no flag changes.

## Useful flags

- `--pair ts,rust|ts,py|rust,py|ts,go|rust,go|py,go` — the two runners to
  compare.
- `--area <name>` — restrict to one area (repeat the flag for several).
- `--tol 5e-4` — float comparison tolerance.
- `--fuzz-count N` — number of fuzz inputs (default 1000).
- `--fail-fast` — stop at the first mismatch (useful when iterating locally).
- `--json` — emit a machine-readable report on stdout in addition to the exit
  code.
- `--ts-cmd` / `--rust-cmd` / `--py-cmd` / `--go-cmd "..."` — override the
  runner commands.

## Regressions

Fuzz mode writes a full reproducer to `tooling/parity/regressions/` on any
mismatch (input args, both implementations' versions, both responses, the
divergence path). The directory is gitignored — promoting a regression into
the permanent corpus requires deciding which implementation was right, which
is a deliberate human act. To promote: triage the JSON, name the canonical
expected value, then add a properly-named case under `conformance/<area>/`.

## What gets compared, and how

| Area | Op(s) | Compare mode |
| --- | --- | --- |
| `normalize` | `normalize` | bytes (exact string match) |
| `roster` | `import`, `export` | `import` is structural JSON; `export` is bytes |
| `cruncher` | `crunch` | floats (per-value `±5e-4`) |
| `compare` | `compare` | floats |
| `loadout` | `loadout` | floats |
| `linked-api` | `linked_query` | structural; cases tagged `set` sort first |
| `attribution` | `attribution` | floats |
| `allocation` | `allocate` | floats |
| `scoring-translation` | `translate_scoring` | structural |
| `effect-translation` | `translate_effect` | structural |
| `applies-to` | `match_applies_to` | structural |
| `scoring` | `score_event`, `score_state`, `wtc_result` | structural |
| `terrain-resolver` | `resolve_terrain` | floats |
| `terrain-keystones` | `keystones` | floats |
| `validator` | `validate` | structural, order-insensitive |
| `share` | `share_encode`, `share_decode` | tokens are bytes; decoded lists are structural |

The differ probes both runners at startup and skips any area where one side
answers `UNKNOWN_OP`. The Rust runner does not implement `compare` or
`loadout`, so those areas run only in pairings without Rust. The corpus areas
`abilities-resolver`, `affordability`, `roster_legality`, `roster_validation`
and `weapon-keywords` are not in the differ; the per-language conformance
tests cover them.

## CI

`.github/workflows/parity.yml` runs the differ on every push and PR: a corpus run for
each of the six pairings, plus normalize and crunch fuzz runs on several
pairings. On a fuzz failure, the workflow uploads
`tooling/parity/regressions/` as an artifact so the divergence can be
inspected without re-running locally.
