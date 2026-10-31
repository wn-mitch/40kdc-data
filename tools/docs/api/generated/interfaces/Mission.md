[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Mission

# Interface: Mission

Defined in: [generated.ts:3391](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3391)

An 11e primary mission (the objective a player scores). Its structured scoring rules live in the same-id primary record in data/core/mission-cards.json and the package's mission-card collection. Which mission a player plays is selected by the Force Disposition matchup matrix (see mission-matchup), keyed on the player's own disposition and their opponent's. Victory points are capped per game and per battle round.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "mission".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3392](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3392)

***

### name

> **name**: `string`

Defined in: [generated.ts:3393](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3393)

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:3397](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3397)

Mission pack or source the mission originates from.

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:3401](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3401)

Community-authored mission/objective summary (original prose only — no reproduced rules text).

***

### vp\_per\_game\_cap?

> `optional` **vp\_per\_game\_cap?**: `number`

Defined in: [generated.ts:3405](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3405)

Maximum primary VP scorable across the whole game. 11e default is 45.

***

### vp\_per\_round\_cap?

> `optional` **vp\_per\_round\_cap?**: `number`

Defined in: [generated.ts:3409](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3409)

Maximum primary VP scorable in a single battle round. 11e default is 15.

***

### secondary\_vp\_per\_game\_cap?

> `optional` **secondary\_vp\_per\_game\_cap?**: `number`

Defined in: [generated.ts:3413](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3413)

Maximum secondary VP scorable across the whole game. 11e default is 45.

***

### secondary\_vp\_per\_round\_cap?

> `optional` **secondary\_vp\_per\_round\_cap?**: `number`

Defined in: [generated.ts:3417](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3417)

Maximum secondary VP scorable in a single battle round. 11e default is 15.

***

### deployment\_pattern\_ids?

> `optional` **deployment\_pattern\_ids?**: `string`[]

Defined in: [generated.ts:3421](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3421)

Ids of the deployment-pattern entities (maps) this mission can be played on. Empty until the per-mission maps are confirmed.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3422](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3422)
