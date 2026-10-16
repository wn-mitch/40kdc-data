[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / checkRoster

# Function: checkRoster()

> **checkRoster**(`roster`, `dataset`): [`RosterLegality`](../interfaces/RosterLegality.md)

Defined in: [data/roster-resolve.ts:620](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L620)

Whole-army legality for a resolved Roster: the per-unit loadout check
plus the nine army-construction dimensions (enhancements, leader attachment,
points, detachment points, force disposition, detachment tags/restrictions/
datasheet exclusions, warlord presence and detachment Warlord requirement,
unit minimums). A roster is legal iff `army` has no `error`-severity
entries and every `units[].violations` is empty.

## Parameters

### roster

`Roster`

### dataset

[`Dataset`](../classes/Dataset.md)

## Returns

[`RosterLegality`](../interfaces/RosterLegality.md)
