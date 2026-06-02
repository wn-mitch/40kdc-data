# Conformance runner protocol

Every language port of `40kdc-data` ships a small **runner** binary that the cross-implementation differ in `tooling/parity/` drives. Runners exist so a single harness can replay the conformance corpus against any pair of implementations and assert byte-equal results — they are not part of the public API of any port.

This document is the protocol contract. Changes to it bump [`SPEC_VERSION`](./SPEC_VERSION).

## Status

The protocol is implemented in TypeScript (`tools/src/runner.ts`) and Rust
(`crates/wh40kdc/src/bin/wh40kdc-runner.rs`); both report `spec_version` 9. The
cross-impl differ in `tooling/parity/` drives any pair of runners against the
corpus.

## Wire format

Runners are stdin/stdout processes. The differ launches a runner once and reuses it for an entire corpus run — **no per-case process invocation** (R interpreter startup alone would make that intolerable). Communication is newline-delimited JSON (NDJSON):

- The differ writes one request per line on the runner's stdin.
- The runner writes one response per line on its stdout.
- The runner writes diagnostics on stderr; stdout is reserved for protocol messages only.

Each line is exactly one valid JSON object terminated by `\n`. UTF-8, no BOM. Lines are not pretty-printed.

## Handshake

The first request after launch is always:

```json
{"op":"init","spec_version":1,"locale":"C","tz":"UTC","seed":0}
```

The runner responds with:

```json
{"ok":true,"value":{"impl":"ts","spec_version":1,"impl_version":"0.4.2"}}
```

The differ fails the run if `spec_version` doesn't match between the request and the response, or if the runner's reported `impl_version` doesn't match what the differ expected based on the implementation under test. `impl` is one of `"ts"`, `"rust"`, `"py"`, `"r"`.

After a successful init the runner must honor the negotiated `locale`, `tz`, and `seed` for all subsequent requests. Implementations that cannot constrain these (e.g., a library that reads `$LANG` internally) must fail the init.

## Operations

After init, the differ issues operation requests. Every request has shape `{"op":"<name>","args":{…}}` and every response has shape `{"ok":true,"value":…}` or `{"ok":false,"error_kind":"<enum>","error_payload":…}`.

The minimum op set:

### `normalize`

```json
{"op":"normalize","args":{"input":"Khârn the Betrayer"}}
```

Response value is a string. Equivalent to TS `normalizeName(input)` / Rust `normalize_name(input)`.

### `import`

```json
{"op":"import","args":{"format":"newrecruit-wtc-compact","input":"…raw text or JSON-stringified object…"}}
```

`format` is one of `listforge`, `newrecruit-json`, `newrecruit-wtc-compact`, `newrecruit-wtc-full`, `newrecruit-simple`, `rosterizer`, `gw`. The `input` field is always a string — JSON formats carry their payload as a JSON-encoded string, text formats carry the raw text. Response value is the resolved `Roster` shape (matches `expected.roster.json` goldens after stripping `source` and `diagnostics` for non-canonical inputs — see CONFORMANCE.md).

A `tryImport` op also exists for auto-detection cases:

```json
{"op":"try_import","args":{"input":"…raw payload…"}}
```

The response value includes the detected `format` plus the imported roster.

### `export`

```json
{"op":"export","args":{"format":"newrecruit-wtc-compact","roster":{…Roster…}}}
```

Response value is a string — the exported roster in the requested format. The differ asserts string equality across implementations.

### `linked_query`

```json
{"op":"linked_query","args":{"query":"abilities_of","input":{"unitId":"intercessor-squad"}}}
```

The `query` enum covers the read paths on `Dataset`:

| `query`                  | `input`                              | result type |
|--------------------------|--------------------------------------|-------------|
| `find_unit`              | `{"query":"<string>"}`               | unit id or null |
| `find_weapon`            | `{"query":"<string>"}`               | weapon id or null |
| `find_faction`           | `{"query":"<string>"}`               | faction id or null |
| `find_ability`           | `{"query":"<string>"}`               | ability id or null |
| `abilities_of`           | `{"unitId":"<id>"}`                  | ordered list of ability ids |
| `weapons_of`             | `{"unitId":"<id>"}`                  | ordered list of weapon ids |
| `phases_of`              | `{"abilityId":"<id>"}`               | ordered list of phase enum values |
| `faction_of`             | `{"unitId":"<id>"}`                  | faction id or null |
| `abilities_of_faction`   | `{"factionId":"<id>"}`               | ordered list of ability ids |
| `weapons_of_faction`     | `{"factionId":"<id>"}`               | ordered list of weapon ids |
| `eligible_abilities`     | `{"input":…,"phase":"<phase>"}`      | ordered list of `{kind, abilityId}` |

Ordering semantics for each query are documented per-area in `CONFORMANCE.md`. The runner protocol itself is opaque to whether the order is load-bearing — it simply emits whatever the implementation's public API returns.

### `validate`

```json
{"op":"validate","args":{"target":"unit","value":{…raw entity…}}}
```

Response value is a list of error objects: `[{"path":"/profiles/0/Sv","code":"RANGE_VIOLATION"}]`. The empty list means "valid." Error message strings are intentionally not part of the protocol.

`code` is drawn from a closed enum:

- `REQUIRED_MISSING` — a schema-required property is absent. `path` is the parent path plus `/` plus the missing property name.
- `TYPE_MISMATCH` — value's JSON type doesn't satisfy the schema's `type` keyword.
- `ENUM_VIOLATION` — value isn't in the schema's `enum`.
- `PATTERN_MISMATCH` — string doesn't match the schema's `pattern` or `format` keyword.
- `RANGE_VIOLATION` — number outside the schema's `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum`, or string/array outside `minLength` / `maxLength` / `minItems` / `maxItems`.
- `ADDITIONAL_PROPERTY` — object has a property not allowed by `additionalProperties: false`.
- `UNIQUE_VIOLATION` — array with `uniqueItems: true` has a duplicate.

Adding a new code is a semantic change to the spec and bumps `SPEC_VERSION`. `target` is one of `unit`, `weapon`, `faction`, `ability` for the initial set; more schemas can be added as needed.

### `crunch`

```json
{"op":"crunch","args":{
  "attacker":{"weaponId":"bolt-rifle","profileIndex":0},
  "modelsFiring":5,
  "target":{"unitId":"intercessor-squad","profileIndex":0},
  "context":{"phase":"shooting","attackerStationary":false,"withinHalfRange":false},
  "buffs":[]
}}
```

Response value is the engine output with the `stages` array. The differ compares per-stage floats with tolerance `5e-4` (see CONFORMANCE.md for the reduction-order invariant).

### `attribution`

```json
{"op":"attribution","args":{
  "attacker":{"weaponId":"bolt-rifle","profileIndex":0},
  "modelsFiring":5,
  "target":{"unitId":"intercessor-squad","profileIndex":0},
  "context":{"phase":"shooting","attackerStationary":false,"withinHalfRange":false},
  "buffs":[],
  "epsilon":1e-6
}}
```

Same input envelope as `crunch`, plus an optional `epsilon` (default `1e-6`)
below which lifts and residuals collapse to zero. Response value is the array of
`AttributedStage`s — the per-stage leave-one-out decomposition documented in
[`CONFORMANCE.md`](../CONFORMANCE.md#attributioncasesjson). Floats compare with
`±5e-4` per value (`expected`, `baseline`, `residual`, each `lifts[].delta`);
`lifts` order is load-bearing (groups appear in first-seen order from the input
`buffs` array). `BuffSource` values inside `lifts[].source` use the serde
kind-tagged discriminated union (`"manual"` / `"ability"` / `"weapon-keyword"`
with camelCase fields).

### `translate_scoring`

```json
{"op":"translate_scoring","args":{"cardId":"death-trap"}}
```

Looks up the `secondary-card` with id `cardId` in the embedded dataset and
humanizes its scoring `awards` into plain English. Response value is
`{"awards": ["<line>", …]}` — one ASCII string per award, **in the card's
`awards` array order** (the order is load-bearing). Equivalent to TS
`describeScoringCard(card)` / Rust `describe_scoring_card(&card)`. The differ
compares the value structurally (exact string equality, no tolerance). An
unknown `cardId` returns `error_kind: "UNKNOWN_ENTITY"`. Only `card_type:
"primary"` cards are exercised by the corpus today (the secondary deck isn't
revealed yet, but the op works for any card present in the dataset).

### `resolve_terrain`

```json
{"op":"resolve_terrain","args":{"layout":{…TerrainLayout…},"templates":[{…TerrainTemplate…}, …]}}
```

Resolves a template-anchored terrain layout to absolute board-space polygon
vertices (board inches, y-down). `layout` is a `terrain-layout` document;
`templates` is the catalog its piece `template` references resolve against
(passed inline so the op is dataset-independent). Response value is
`{"pieces": [{"id": <string|null>, "name": <string|null>, "piece_type":
"area"|"feature", "floor": <int>, "vertices": [{"x": <num>, "y": <num>}, …]},
…]}`.

Pieces are emitted in `layout.pieces` order; an area piece that instances a
template carrying composed `features` emits those features immediately after it,
in template-declaration order. Vertices are rounded to 4 dp; the differ compares
them with float tolerance (`5e-4`) and the identity fields exactly. Equivalent
to TS `resolveLayout(layout, templates)` / Rust `resolve_layout(&layout,
&templates)`. A layout that references a missing template, or a piece with
neither `footprint` nor `template`, returns `error_kind: "INVALID_INPUT"`.

The transform contract (mirror → rotate → translate about the footprint
centroid; clockwise rotation in the y-down frame) is specified in CONFORMANCE.md
under the `terrain-resolver` per-area invariants.

### `shutdown`

```json
{"op":"shutdown"}
```

Runner responds with `{"ok":true,"value":null}` and exits with code 0. The differ uses this for clean teardown; SIGKILL is the fallback if shutdown hangs.

## Error envelope

Every error response uses this shape:

```json
{"ok":false,"error_kind":"INVALID_INPUT","error_payload":{"detail":"…free-form, never compared…"}}
```

`error_kind` is a closed enum:

- `INVALID_INPUT` — malformed args for the requested op.
- `UNKNOWN_OP` — op name not recognized by this runner version.
- `UNKNOWN_ENTITY` — requested unit/weapon/ability/faction id not present in the embedded dataset.
- `IMPORT_FAILED` — adapter could not parse the input (importer-level failure, distinct from dataset-resolution failure).
- `EXPORT_FAILED` — serializer error.
- `VALIDATION_ERROR` — schema validator itself failed (the validator threw, not "input was invalid" — that returns `ok:true` with an error list).
- `CRUNCH_ERROR` — engine refused to run (e.g., target has no save profile).
- `INTERNAL_ERROR` — a bug in the runner that should never fire.

Adding a new `error_kind` is a semantic change to the spec and bumps `SPEC_VERSION`. Cross-implementation tests assert on `error_kind`, never on `error_payload`.

## Batching

The differ may pipeline requests — it does not wait for a response before sending the next request. Runners must handle this: parse stdin line by line, respond in order, never reorder responses. Implementations whose host language doesn't allow line-buffered stdout (R, looking at you) must explicitly flush after each response.

## Determinism

After init, runners must produce identical responses for identical requests across runs. Concretely:

- No reliance on system time, hostname, PID, or environment variables not surfaced through the `init` envelope.
- Iteration order over hash-based collections must be stable (use ordered maps or sort before emitting).
- Any randomness (currently only property-fuzz inputs from the differ side) is seeded via the `init` envelope's `seed`.

## Open questions

- Whether `crunch` should take an inline weapon/unit shape (full struct) in addition to id references. Today the corpus only uses id references; if Python's downstream users want to run crunch on synthetic entities, the op signature would need a discriminated union.
- Whether `import` should also accept a typed `Roster` shape as input (i.e., re-import from a structured roster, not a serialized string). The use case isn't clear yet.
- Streaming protocol (length-prefixed framing) versus NDJSON for the larger payloads (full roster exports). NDJSON works as long as no payload contains a literal newline outside a JSON string, which is guaranteed by JSON's grammar. Defer the switch until a concrete problem appears.
