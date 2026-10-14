[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / checkRoster

# Function: checkRoster()

> **checkRoster**(`roster`, `dataset`): [`RosterLegality`](../interfaces/RosterLegality.md)

Defined in: [data/roster-resolve.ts:469](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L469)

Whole-army legality for a resolved Roster: the per-unit loadout check
plus the nine army-construction dimensions (enhancements, leader attachment,
points, detachment points, force disposition, detachment tags/restrictions,
warlord, unit minimums). A roster is legal iff `army` has no `error`-severity
entries and every `units[].violations` is empty.

## Parameters

### roster

`Roster`

### dataset

[`Dataset`](../classes/Dataset.md)

## Returns

[`RosterLegality`](../interfaces/RosterLegality.md)
