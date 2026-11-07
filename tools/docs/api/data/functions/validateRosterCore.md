[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / validateRosterCore

# Function: validateRosterCore()

> **validateRosterCore**(`spec`, `dataset`): [`RosterLegality`](../interfaces/RosterLegality.md)

Defined in: [data/roster-resolve.ts:228](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L228)

The shared roster-legality core. Runs the per-unit loadout check on every
resolved unit, then the nine army-construction dimensions. `unitIndex` on a
unit-scoped violation indexes `spec.units` (= the roster's unit order).

## Parameters

### spec

[`NormRoster`](../interfaces/NormRoster.md)

### dataset

[`Dataset`](../classes/Dataset.md)

## Returns

[`RosterLegality`](../interfaces/RosterLegality.md)
