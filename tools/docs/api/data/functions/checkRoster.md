[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / checkRoster

# Function: checkRoster()

> **checkRoster**(`roster`, `dataset`): [`RosterLegality`](../interfaces/RosterLegality.md)

Defined in: [data/roster-resolve.ts:627](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L627)

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
