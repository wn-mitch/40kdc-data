[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TerrainTemplate

# Interface: TerrainTemplate

Defined in: [generated.ts:1067](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1067)

A reusable terrain piece in the standard catalog: a gameplay area (the 11e terrain-area templates) or a scenery feature (walls, containers, pipes, floor segments). Footprints are authored in natural local inches; the terrain resolver derives each footprint's polygon area centroid and re-centers on it, so a layout piece that instances a template places its centroid via the layout's `position`. An `area` template may carry an embedded `features` list — scenery placed in the area's centroid-local frame — making the template a reusable composition (e.g. a ruin with its walls). Placing such a template places all of its features, transformed by the area's own placement.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "terrain-template".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:1068](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1068)

***

### name

> **name**: `string`

Defined in: [generated.ts:1069](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1069)

***

### kind

> **kind**: `"area"` \| `"feature"`

Defined in: [generated.ts:1073](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1073)

`area` = a gameplay terrain zone; `feature` = physical scenery placed on an area.

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:1077](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1077)

Catalog or mission pack the template originates from.

***

### footprint

> **footprint**: [`Footprint`](../type-aliases/Footprint.md)

Defined in: [generated.ts:1078](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1078)

***

### default\_height\_inches?

> `optional` **default\_height\_inches?**: `number`

Defined in: [generated.ts:1082](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1082)

Default height in inches for pieces instancing this template. Gates Plunging Fire (>= 3").

***

### default\_blocking?

> `optional` **default\_blocking?**: `boolean`

Defined in: [generated.ts:1086](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1086)

Whether the template blocks line of sight / movement by default.

***

### ground\_accessible?

> `optional` **ground\_accessible?**: `boolean`

Defined in: [generated.ts:1090](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1090)

Whether models may be placed on the ground footprint. `false` marks an elevated-only piece (a platform reachable only on its `upper_floor`, e.g. a gantry/catwalk) or a solid obstacle with no valid placement (e.g. a generator). Meaningful for `kind: "feature"`.

***

### upper\_floor?

> `optional` **upper\_floor?**: `object`

Defined in: [generated.ts:1094](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1094)

An elevated platform carried by this feature (e.g. a ruin's second storey). Its footprint is authored in the SAME local frame as `footprint` and re-centered on the GROUND footprint's polygon area centroid, so the two floors stay registered when the piece is placed, rotated, or mirrored. Non-resolved metadata: the terrain resolver does not emit it; authoring/visualization tools render it as an overlay. Meaningful for `kind: "feature"`.

#### footprint

> **footprint**: [`Footprint`](../type-aliases/Footprint.md)

#### floor?

> `optional` **floor?**: `number`

Ruin floor this platform occupies (1 = first floor above ground).

***

### default\_terrain\_area\_keywords?

> `optional` **default\_terrain\_area\_keywords?**: [`TerrainAreaKeyword`](../type-aliases/TerrainAreaKeyword.md)[]

Defined in: [generated.ts:1104](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1104)

Terrain-area keywords areas of this template carry by default. Meaningful for `kind: "area"`.

***

### features?

> `optional` **features?**: [`ComposedFeature`](ComposedFeature.md)[]

Defined in: [generated.ts:1108](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1108)

Composed scenery features, in the area's centroid-local frame. Only meaningful for `kind: "area"`.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1109](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1109)
