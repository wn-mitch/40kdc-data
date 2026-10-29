[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / HullShape

# Interface: HullShape

Defined in: [generated.ts:3163](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3163)

A model's 2D collision footprint as an explicit polygon, used in place of a circular/oval base for vehicles and other hull-based models. Points are authored in local inches (y-down); a consumer re-centers the polygon on its area centroid before placement, so the local origin does not affect where the model lands — only its shape matters (mirrors the terrain-template footprint convention). A hull shape is faction-agnostic and reusable: one outline (e.g. a Rhino chassis) is authored once and referenced by `hull_shape_id` from every model that shares that hull, across factions. This entity stores geometry only — never an image, image URL, or any source-asset metadata.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "hull-shape".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3164](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3164)

***

### name

> **name**: `string`

Defined in: [generated.ts:3165](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3165)

***

### points

> **points**: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]

Defined in: [generated.ts:3171](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3171)

Polygon vertices in local inches (y-down), in order around the outline. A hull is always a polygon (never a rectangle/right-triangle), so the points are given directly rather than via the shared `footprint` oneOf.

#### Min Items

3

***

### bounds\_width\_in

> **bounds\_width\_in**: `number`

Defined in: [generated.ts:3175](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3175)

Cached axis-aligned bounding-box width in inches (max x − min x). Derived from `points`; recorded so consumers can size/scale without recomputing.

***

### bounds\_height\_in

> **bounds\_height\_in**: `number`

Defined in: [generated.ts:3179](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3179)

Cached axis-aligned bounding-box height in inches (max y − min y). Derived from `points`.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3180](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3180)
