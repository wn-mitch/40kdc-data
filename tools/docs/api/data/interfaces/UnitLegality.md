[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / UnitLegality

# Interface: UnitLegality

Defined in: [data/roster-resolve.ts:75](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L75)

The loadout-legality verdict for one resolved roster unit.

## Properties

### unitId

> **unitId**: `string`

Defined in: [data/roster-resolve.ts:77](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L77)

Resolved unit id.

***

### unitIndex

> **unitIndex**: `number`

Defined in: [data/roster-resolve.ts:79](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L79)

The unit's position in `roster.units` (source order).

***

### modelCount

> **modelCount**: `number`

Defined in: [data/roster-resolve.ts:81](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L81)

Model count the loadout was checked against.

***

### violations

> **violations**: [`Violation`](Violation.md)[]

Defined in: [data/roster-resolve.ts:83](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/roster-resolve.ts#L83)

Every count/swap rule the unit's loadout breaks; empty when legal.
