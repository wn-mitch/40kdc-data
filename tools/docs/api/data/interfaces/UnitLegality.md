[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / UnitLegality

# Interface: UnitLegality

Defined in: [data/roster-resolve.ts:75](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L75)

The loadout-legality verdict for one resolved roster unit.

## Properties

### unitId

> **unitId**: `string`

Defined in: [data/roster-resolve.ts:77](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L77)

Resolved unit id.

***

### unitIndex

> **unitIndex**: `number`

Defined in: [data/roster-resolve.ts:79](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L79)

The unit's position in `roster.units` (source order).

***

### modelCount

> **modelCount**: `number`

Defined in: [data/roster-resolve.ts:81](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L81)

Model count the loadout was checked against.

***

### violations

> **violations**: [`Violation`](Violation.md)[]

Defined in: [data/roster-resolve.ts:83](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/roster-resolve.ts#L83)

Every count/swap rule the unit's loadout breaks; empty when legal.
