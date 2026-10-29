[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Mission

# Interface: Mission

Defined in: [generated.ts:3264](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3264)

An 11e primary mission (the objective a player scores). Its structured scoring rules live in the same-id primary record in data/core/mission-cards.json and the package's mission-card collection. Which mission a player plays is selected by the Force Disposition matchup matrix (see mission-matchup), keyed on the player's own disposition and their opponent's. Victory points are capped per game and per battle round.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "mission".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3265](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3265)

***

### name

> **name**: `string`

Defined in: [generated.ts:3266](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3266)

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:3270](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3270)

Mission pack or source the mission originates from.

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:3274](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3274)

Community-authored mission/objective summary (original prose only — no reproduced rules text).

***

### vp\_per\_game\_cap?

> `optional` **vp\_per\_game\_cap?**: `number`

Defined in: [generated.ts:3278](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3278)

Maximum primary VP scorable across the whole game. 11e default is 45.

***

### vp\_per\_round\_cap?

> `optional` **vp\_per\_round\_cap?**: `number`

Defined in: [generated.ts:3282](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3282)

Maximum primary VP scorable in a single battle round. 11e default is 15.

***

### secondary\_vp\_per\_game\_cap?

> `optional` **secondary\_vp\_per\_game\_cap?**: `number`

Defined in: [generated.ts:3286](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3286)

Maximum secondary VP scorable across the whole game. 11e default is 45.

***

### secondary\_vp\_per\_round\_cap?

> `optional` **secondary\_vp\_per\_round\_cap?**: `number`

Defined in: [generated.ts:3290](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3290)

Maximum secondary VP scorable in a single battle round. 11e default is 15.

***

### deployment\_pattern\_ids?

> `optional` **deployment\_pattern\_ids?**: `string`[]

Defined in: [generated.ts:3294](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3294)

Ids of the deployment-pattern entities (maps) this mission can be played on. Empty until the per-mission maps are confirmed.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3295](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3295)
