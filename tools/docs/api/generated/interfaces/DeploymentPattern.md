[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DeploymentPattern

# Interface: DeploymentPattern

Defined in: [generated.ts:1211](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1211)

A deployment map: per-side deployment zones, objective positions, and (11e) per-side territory polygons. Pattern geometry carries forward unchanged from 10th edition; downstream tooling (e.g. bevy-deploy-helper) consumes this as the canonical encoding.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "deployment-pattern".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:1212](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1212)

***

### name

> **name**: `string`

Defined in: [generated.ts:1213](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1213)

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:1217](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1217)

Mission pack or source the pattern originates from (e.g. 'leviathan').

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:1218](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1218)

***

### zones

> **zones**: \[\{ `player`: [`Side`](../type-aliases/Side.md); `name?`: `string`; `shape`: [`ZoneShape`](../type-aliases/ZoneShape.md); `position`: [`Vec2`](Vec2.md); `color?`: `string`; \}, `...{ player: Side; name?: string; shape: ZoneShape; position: Vec2; color?: string }[]`\]

Defined in: [generated.ts:1224](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1224)

Per-side deployment zones.

#### Min Items

1

***

### territories?

> `optional` **territories?**: `object`[]

Defined in: [generated.ts:1249](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1249)

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

Defined in: [generated.ts:1257](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1257)

Objective-marker positions on the board.

***

### recommended\_terrain\_layout\_ids?

> `optional` **recommended\_terrain\_layout\_ids?**: `string`[]

Defined in: [generated.ts:1261](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1261)

Ids of recommended terrain-layout entities (resolved once terrain-layout data is authored).

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1262](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1262)
