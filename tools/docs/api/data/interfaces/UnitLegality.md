[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / UnitLegality

# Interface: UnitLegality

Defined in: [data/roster-resolve.ts:74](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L74)

The loadout-legality verdict for one resolved roster unit.

## Properties

### unitId

> **unitId**: `string`

Defined in: [data/roster-resolve.ts:76](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L76)

Resolved unit id.

***

### unitIndex

> **unitIndex**: `number`

Defined in: [data/roster-resolve.ts:78](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L78)

The unit's position in `roster.units` (source order).

***

### modelCount

> **modelCount**: `number`

Defined in: [data/roster-resolve.ts:80](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L80)

Model count the loadout was checked against.

***

### violations

> **violations**: [`Violation`](Violation.md)[]

Defined in: [data/roster-resolve.ts:82](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/roster-resolve.ts#L82)

Every count/swap rule the unit's loadout breaks; empty when legal.
