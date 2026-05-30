# The 130 "unencodable" — dug into

Short version: **the schema can express essentially every in-battle ability.**
"Unencodable" was inflated by (1) an over-conservative repair prompt, (2) the
model bailing rather than risk an invalid enum, and (3) conflating *army-list /
setup rules* (a different domain) with *ability effects*.

## Proof points (all AJV-validated against `ability.schema.json`)

| Pattern | Valid today? | Note |
|---|---|---|
| `dice-gated` ("roll D6, on 2+ resurrect") | ✅ yes | Failed first only because I wrote `comparison:"greater-or-equal"` — the enum is `"gte"`. Same mistake the model makes when it punts. |
| `choice` ("select one of N abilities") | ✅ yes | Warmaster / Daemon Primarch selection. |
| `operation:"set"` ("OC characteristic of 9") | ✅ yes | Valid DSL. My prompt *told* the model to punt on set-ops. |
| `weapon_name` filter on stat-modifier | ✅ yes | Already canonical (gold uses `weapon_name`). My prompt forbade it. |

## The 130, by source-rule pattern

| # | Bucket | Count | Reality |
|---|---|---|---|
| B | **dice-gated** ("roll D6, on 2+…") | 13 | Schema **already** has `dice-gated`. Model punted. |
| C | **leadership / battle-shock re-roll** | 4 | Already encodable (`leadership-modifier {operation:"re-roll"}`). Punted. |
| D | **set-characteristic** ("OC of 9", "A of 6") | 13 | `operation:"set"` is valid DSL. Prompt told it to punt. |
| G | **weapon-name filter** | 2 | `weapon_name` already canonical. Prompt forbade it. |
| F | **terrain movement** ("move through terrain") | 7 | Needs one `move_type` vocab value. Trivial. |
| A | **list-building / meta** | 14 | "Include one X per Y", "cannot be Warlord", roll-offs. **Not effects.** |
| E | **deployment / redeploy** | 32 | Pre-game placement abilities (Deep Strike variants, Strategic Reserves). |
| Z | **other** | 45 | Mix — transport capacity, model geometry, "select one of N" (= `choice`, encodable), Contagion-range adds (= stat-modifier), etc. |

### Winnable with **zero schema change** (~32)
B + C + D + G + the `choice` cases in Z. They failed only because:
1. **My repair prompt was over-conservative** — it literally instructed the model
   to set `unencodable` for set-operations and weapon/model filters.
2. **The model trips on exact enums** (`gte` vs `greater-or-equal`) and bails to
   `unencodable` rather than emit something AJV might reject.

### Genuinely not an *effect* (bucket A + parts of Z)
Army-construction ("include one Inquisitorial Agents per Inquisitor"), roster
selection ("cannot be your Warlord"), model geometry ("highlighted parts make up
the hull"), transport capacity. These are **list-validity / setup constraints**,
a different domain than an ability-effect DSL. Right fix: **re-type** them (a
non-effect `ability_type`), not bend the effect schema.

### The only honest *effect*-domain gaps across the whole model pool
- **modifier-immunity** ("cannot be targeted by Stratagems" / "ignores modifiers
  to its characteristics")
- **rule-replacement / transformation** ("replace this model with…")

Both are rare and would be **new leaf types**, not a structural limit.

## The one real tension (needs a decision)

Filters like `weapon_name` / "non-Character models" are **valid data**, but the
**cruncher silently ignores them today** — so an ignored filter on an additive
buff = over-apply (the exact trap `lintCanonical` guards against). To let the data
carry these filters *and* keep the cruncher honest, `from-dsl.ts` must be hardened
to mark any buff carrying a filter it can't honor as `unsupported` (fail-safe),
instead of applying it unfiltered.

## Options

**1. Loosen prompt + harden engine (most complete).**
Re-run the unencodable set with an enum-precise, less-conservative prompt (permit
set-ops, `weapon_name`, dice-gated, choice); extend `lintCanonical` to allow
`weapon_name`/`weapon_type`; AND harden `from-dsl.ts` to mark filter-bearing buffs
`unsupported`. Touches the engine — so also Rust (`from_dsl` doesn't exist yet) for
parity + new conformance goldens.

**2. Loosen prompt only, no filters (most of the win, zero engine risk).**
Re-run to capture set-ops, dice-gated, choice, leadership-re-roll (B/C/D + choice
≈ 30) — all cruncher-inert or already fail-safe — but keep `weapon_name` / model
filters OUT until the engine is filter-aware. Defers the 2 weapon-filter + the
model-filter cases.

**3. Re-type the non-effects first (smallest, highest-certainty).**
Leave authoring as-is; correctly re-type the ~14 army-construction / meta rules
(bucket A) out of the effect DSL so the dataset stops mis-stamping them as effects.
Defer the encoding-capture work.
