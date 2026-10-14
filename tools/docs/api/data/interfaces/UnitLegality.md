[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / UnitLegality

# Interface: UnitLegality

Defined in: [data/roster-resolve.ts:69](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L69)

The loadout-legality verdict for one resolved roster unit.

## Properties

### unitId

> **unitId**: `string`

Defined in: [data/roster-resolve.ts:71](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L71)

Resolved unit id.

***

### unitIndex

> **unitIndex**: `number`

Defined in: [data/roster-resolve.ts:73](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L73)

The unit's position in `roster.units` (source order).

***

### modelCount

> **modelCount**: `number`

Defined in: [data/roster-resolve.ts:75](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L75)

Model count the loadout was checked against.

***

### violations

> **violations**: [`Violation`](Violation.md)[]

Defined in: [data/roster-resolve.ts:77](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L77)

Every count/swap rule the unit's loadout breaks; empty when legal.
