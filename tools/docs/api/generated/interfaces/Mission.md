[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Mission

# Interface: Mission

Defined in: [generated.ts:2885](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2885)

An 11e primary mission (the objective a player scores). Its structured scoring rules live in the same-id primary record in data/core/mission-cards.json and the package's mission-card collection. Which mission a player plays is selected by the Force Disposition matchup matrix (see mission-matchup), keyed on the player's own disposition and their opponent's. Victory points are capped per game and per battle round.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "mission".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:2886](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2886)

***

### name

> **name**: `string`

Defined in: [generated.ts:2887](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2887)

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:2891](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2891)

Mission pack or source the mission originates from.

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:2895](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2895)

Community-authored mission/objective summary (original prose only — no reproduced rules text).

***

### vp\_per\_game\_cap?

> `optional` **vp\_per\_game\_cap?**: `number`

Defined in: [generated.ts:2899](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2899)

Maximum primary VP scorable across the whole game. 11e default is 45.

***

### vp\_per\_round\_cap?

> `optional` **vp\_per\_round\_cap?**: `number`

Defined in: [generated.ts:2903](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2903)

Maximum primary VP scorable in a single battle round. 11e default is 15.

***

### secondary\_vp\_per\_game\_cap?

> `optional` **secondary\_vp\_per\_game\_cap?**: `number`

Defined in: [generated.ts:2907](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2907)

Maximum secondary VP scorable across the whole game. 11e default is 45.

***

### secondary\_vp\_per\_round\_cap?

> `optional` **secondary\_vp\_per\_round\_cap?**: `number`

Defined in: [generated.ts:2911](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2911)

Maximum secondary VP scorable in a single battle round. 11e default is 15.

***

### deployment\_pattern\_ids?

> `optional` **deployment\_pattern\_ids?**: `string`[]

Defined in: [generated.ts:2915](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2915)

Ids of the deployment-pattern entities (maps) this mission can be played on. Empty until the per-mission maps are confirmed.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:2916](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2916)
