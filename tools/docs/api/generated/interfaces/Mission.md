[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Mission

# Interface: Mission

Defined in: [generated.ts:461](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L461)

An 11e primary mission (the objective a player scores). Which mission a player plays is selected by the Force Disposition matchup matrix (see mission-matchup), keyed on the player's own disposition and their opponent's. Victory points are capped per game and per battle round.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "mission".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:462](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L462)

***

### name

> **name**: `string`

Defined in: [generated.ts:463](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L463)

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:467](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L467)

Mission pack or source the mission originates from.

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:471](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L471)

Community-authored mission/objective summary (original prose only — no reproduced rules text).

***

### vp\_per\_game\_cap?

> `optional` **vp\_per\_game\_cap?**: `number`

Defined in: [generated.ts:475](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L475)

Maximum primary VP scorable across the whole game. 11e default is 45.

***

### vp\_per\_round\_cap?

> `optional` **vp\_per\_round\_cap?**: `number`

Defined in: [generated.ts:479](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L479)

Maximum primary VP scorable in a single battle round. 11e default is 15.

***

### deployment\_pattern\_ids?

> `optional` **deployment\_pattern\_ids?**: `string`[]

Defined in: [generated.ts:483](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L483)

Ids of the deployment-pattern entities (maps) this mission can be played on. Empty until the per-mission maps are confirmed.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:484](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L484)
