[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / validateRosterCore

# Function: validateRosterCore()

> **validateRosterCore**(`spec`, `dataset`): [`RosterLegality`](../interfaces/RosterLegality.md)

Defined in: [data/roster-resolve.ts:226](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L226)

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
