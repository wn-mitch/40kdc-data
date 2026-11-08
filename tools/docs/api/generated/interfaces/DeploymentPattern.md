[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DeploymentPattern

# Interface: DeploymentPattern

Defined in: [generated.ts:2966](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2966)

A deployment map: per-side deployment zones, objective positions, and (11e) per-side territory polygons. Pattern geometry carries forward unchanged from 10th edition; downstream tooling (e.g. bevy-deploy-helper) consumes this as the canonical encoding.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "deployment-pattern".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:2967](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2967)

***

### name

> **name**: `string`

Defined in: [generated.ts:2968](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2968)

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:2972](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2972)

Mission pack or source the pattern originates from (e.g. 'leviathan').

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:2973](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2973)

***

### zones

> **zones**: \[\{ `player`: [`Side`](../type-aliases/Side.md); `name?`: `string`; `shape`: [`ZoneShape`](../type-aliases/ZoneShape.md); `position`: [`Vec2`](Vec2.md); `color?`: `string`; \}, `...{ player: Side; name?: string; shape: ZoneShape; position: Vec2; color?: string }[]`\]

Defined in: [generated.ts:2979](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2979)

Per-side deployment zones.

#### Min Items

1

***

### territories?

> `optional` **territories?**: `object`[]

Defined in: [generated.ts:3004](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3004)

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

Defined in: [generated.ts:3012](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3012)

Objective-marker positions on the board.

***

### recommended\_terrain\_layout\_ids?

> `optional` **recommended\_terrain\_layout\_ids?**: `string`[]

Defined in: [generated.ts:3016](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3016)

Ids of recommended terrain-layout entities (resolved once terrain-layout data is authored).

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3017](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3017)
