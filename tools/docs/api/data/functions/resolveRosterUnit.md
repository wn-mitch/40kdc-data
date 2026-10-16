[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveRosterUnit

# Function: resolveRosterUnit()

> **resolveRosterUnit**(`rosterUnit`, `dataset`, `factionId?`): [`UnitView`](../classes/UnitView.md) \| `undefined`

Defined in: [data/roster-resolve.ts:32](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L32)

Resolve a roster's unit entry against the dataset, returning the linked
[UnitView](../classes/UnitView.md). Returns `undefined` when:
  - the roster's `ref.id` is `null` (the importer couldn't match the unit), or
  - the id doesn't appear in the dataset (e.g. the roster was authored
    against an older dataslate than the bundled one).

Doesn't surface diagnostics — the caller already has them on the roster's
own `diagnostics` field.

## Parameters

### rosterUnit

`RosterUnit`

### dataset

[`Dataset`](../classes/Dataset.md)

### factionId?

`string` \| `null`

## Returns

[`UnitView`](../classes/UnitView.md) \| `undefined`
