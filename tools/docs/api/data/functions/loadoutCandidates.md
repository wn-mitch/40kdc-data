[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / loadoutCandidates

# Function: loadoutCandidates()

> **loadoutCandidates**(`unit`, `modelCount`, `options`, `models?`, `tiers?`, `limit?`): `string`[]

Defined in: [data/loadout.ts:1537](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L1537)

Every legal squad build for `modelCount` models, encoded in deterministic
canonical traversal order as `"<witness> => <counts>"` strings — the candidate
generator a damage optimiser needs, without forcing one alternative into
[baseLoadout](baseLoadout.md).

Tiers are the size gate: when the composition declares them, every tier whose
total range contains `modelCount` contributes its own bounded per-row
allocations (so a size reachable only by taking two leaders is reachable here);
with no tiers the top-level `models[]` envelope is enumerated directly. A size
no tier admits yields the empty list, as does a unit with no composition rows —
"no legal build" and "no modelled breakdown" are both honestly zero candidates.

Results are globally deduped in first-seen traversal order (tiers, descending
row allocations, rows, then declared variants and their option states), then
truncated to `limit` (default [LOADOUT\_CANDIDATES\_DEFAULT\_LIMIT](../variables/LOADOUT_CANDIDATES_DEFAULT_LIMIT.md)) with
[LOADOUT\_CANDIDATES\_TRUNCATED](../variables/LOADOUT_CANDIDATES_TRUNCATED.md) appended when a distinct `limit + 1`
candidate exists. Allocations and assignments are streamed, so traversal stops
immediately once that proof is found. Mirror of
`crates/wh40kdc/src/data/loadout.rs`.

Rows with `loadout_variants` enumerate every legal multiset of named variants;
other rows contribute their recorded defaults exactly once.

## Parameters

### unit

[`Unit`](../../generated/interfaces/Unit.md)

### modelCount

`number`

### options

readonly [`WargearOption`](../../generated/interfaces/WargearOption.md)[]

### models?

readonly [`LoadoutModel`](../interfaces/LoadoutModel.md)[]

### tiers?

readonly `LoadoutTier`[]

### limit?

`number`

## Returns

`string`[]
