# Cross-implementation parity differ

A stdlib-only Python script that drives two NDJSON runners (TypeScript and
Rust by default) against the conformance corpus at `conformance/` and asserts
byte- or tolerance-equal responses. The runners speak the wire protocol in
[`conformance/RUNNER_PROTOCOL.md`](../../conformance/RUNNER_PROTOCOL.md); both
implementations embed the corpus `SPEC_VERSION` and refuse to participate on
mismatch.

Per-language conformance tests in `tools/test/conformance.test.ts` and
`crates/wh40kdc/tests/*.rs` continue to verify each impl against the goldens.
The differ is the **additional** gate that catches *co-drift* — both impls
agreeing with a regenerated golden that's actually wrong, or both following
the curated corpus but disagreeing on inputs nobody wrote down.

## Quick start

From the repo root, with both runners built:

```bash
# 1. Build the runners (skipped automatically if pre-built artifacts exist).
cd tools && npm ci && npm run build && cd ..
cargo build --release --bin wh40kdc-runner

# 2. Corpus parity — runs every case across normalize / roster / cruncher /
#    linked-api / attribution. Exits 0 iff every case agrees.
python3 tooling/parity/differ.py

# 3. Property-style fuzzing — deterministic random inputs both impls have to
#    agree on. Mismatches dump full reproducers into regressions/.
python3 tooling/parity/differ.py --mode fuzz --fuzz-target normalize --fuzz-seed 42
python3 tooling/parity/differ.py --mode fuzz --fuzz-target crunch     --fuzz-seed 42
```

## Auto-detection

`--ts-cmd` defaults to `node tools/dist/runner.js` if the built artifact
exists, otherwise `npx tsx tools/src/runner.ts`. `--rust-cmd` defaults to
`target/release/wh40kdc-runner` if present, otherwise the debug build, and
finally falls back to `cargo run --quiet --release --bin wh40kdc-runner`. The
same invocation works locally (running from source) and in CI (running from
pre-built artifacts) with no flag changes.

## Useful flags

- `--area normalize|roster|cruncher|linked-api|attribution` — restrict to one
  area (repeat the flag for several).
- `--tol 5e-4` — float comparison tolerance.
- `--fail-fast` — stop at the first mismatch (useful when iterating locally).
- `--json` — emit a machine-readable report on stdout in addition to the exit
  code.
- `--ts-cmd "..."` / `--rust-cmd "..."` — override the runner commands.

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
| `linked-api` | `linked_query` | structural; cases tagged `set` sort first |
| `attribution` | `attribution` | floats (per-value `±5e-4`) |

`validator` is not in the differ today — Rust has no validator yet, and the
runner reports `UNKNOWN_OP` for `validate`. The differ probes both runners at
startup and silently disables any area where one side rejects the op.

## CI

`.github/workflows/parity.yml` runs the differ on every PR (corpus run +
both fuzz modes). On a fuzz failure, the workflow uploads
`tooling/parity/regressions/` as an artifact so the divergence can be
inspected without re-running locally.
