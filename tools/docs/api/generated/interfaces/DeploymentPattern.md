[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DeploymentPattern

# Interface: DeploymentPattern

Defined in: [generated.ts:2521](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2521)

A deployment map: per-side deployment zones, objective positions, and (11e) per-side territory polygons. Pattern geometry carries forward unchanged from 10th edition; downstream tooling (e.g. bevy-deploy-helper) consumes this as the canonical encoding.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "deployment-pattern".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:2522](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2522)

***

### name

> **name**: `string`

Defined in: [generated.ts:2523](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2523)

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:2527](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2527)

Mission pack or source the pattern originates from (e.g. 'leviathan').

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:2528](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2528)

***

### zones

> **zones**: \[\{ `player`: [`Side`](../type-aliases/Side.md); `name?`: `string`; `shape`: [`ZoneShape`](../type-aliases/ZoneShape.md); `position`: [`Vec2`](Vec2.md); `color?`: `string`; \}, `...{ player: Side; name?: string; shape: ZoneShape; position: Vec2; color?: string }[]`\]

Defined in: [generated.ts:2534](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2534)

Per-side deployment zones.

#### Min Items

1

***

### territories?

> `optional` **territories?**: `object`[]

Defined in: [generated.ts:2559](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2559)

11e per-side territory polygons, mirroring the deployment-zone shape (e.g. the band between a deployment zone and the midline). Empty until authored.

#### player

> **player**: [`Side`](../type-aliases/Side.md)

#### shape

> **shape**: [`ZoneShape`](../type-aliases/ZoneShape.md)

#### position

> **position**: [`Vec2`](Vec2.md)

***

### objectives?

> `optional` **objectives?**: [`Vec2`](Vec2.md)[]

Defined in: [generated.ts:2567](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2567)

Objective-marker positions on the board.

***

### recommended\_terrain\_layout\_ids?

> `optional` **recommended\_terrain\_layout\_ids?**: `string`[]

Defined in: [generated.ts:2571](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2571)

Ids of recommended terrain-layout entities (resolved once terrain-layout data is authored).

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:2572](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2572)
