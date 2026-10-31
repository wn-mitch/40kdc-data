[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TerrainTemplate

# Interface: TerrainTemplate

Defined in: [generated.ts:7601](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7601)

A reusable terrain piece in the standard catalog: a gameplay area (the 11e terrain-area templates) or a scenery feature (walls, containers, pipes, floor segments). Footprints are authored in natural local inches; the terrain resolver derives each footprint's polygon area centroid and re-centers on it, so a layout piece that instances a template places its centroid via the layout's `position`. An `area` template may carry an embedded `features` list — scenery placed in the area's centroid-local frame — making the template a reusable composition (e.g. a ruin with its walls). Placing such a template places all of its features, transformed by the area's own placement.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "terrain-template".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:7602](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7602)

***

### name

> **name**: `string`

Defined in: [generated.ts:7603](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7603)

***

### kind

> **kind**: `"area"` \| `"feature"`

Defined in: [generated.ts:7607](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7607)

`area` = a gameplay terrain zone; `feature` = physical scenery placed on an area.

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:7611](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7611)

Catalog or mission pack the template originates from.

***

### footprint

> **footprint**: [`Footprint`](../type-aliases/Footprint.md)

Defined in: [generated.ts:7612](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7612)

***

### default\_height\_inches?

> `optional` **default\_height\_inches?**: `number`

Defined in: [generated.ts:7616](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7616)

Default height in inches for pieces instancing this template. Gates Plunging Fire (>= 3").

***

### default\_blocking?

> `optional` **default\_blocking?**: `boolean`

Defined in: [generated.ts:7620](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7620)

Whether the template blocks line of sight / movement by default.

***

### ground\_accessible?

> `optional` **ground\_accessible?**: `boolean`

Defined in: [generated.ts:7624](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7624)

Whether models may be placed on the ground footprint. `false` marks an elevated-only piece (a platform reachable only on its `upper_floor`, e.g. a gantry/catwalk) or a solid obstacle with no valid placement (e.g. a generator). Meaningful for `kind: "feature"`.

***

### upper\_floor?

> `optional` **upper\_floor?**: `object`

Defined in: [generated.ts:7628](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7628)

An elevated platform carried by this feature (e.g. a ruin's second storey). Its footprint is authored in the SAME local frame as `footprint` and re-centered on the GROUND footprint's polygon area centroid, so the two floors stay registered when the piece is placed, rotated, or mirrored. Non-resolved metadata: the terrain resolver does not emit it; authoring/visualization tools render it as an overlay. Meaningful for `kind: "feature"`.

#### footprint

> **footprint**: [`Footprint`](../type-aliases/Footprint.md)

#### floor?

> `optional` **floor?**: `number`

Ruin floor this platform occupies (1 = first floor above ground).

***

### default\_terrain\_area\_keywords?

> `optional` **default\_terrain\_area\_keywords?**: [`TerrainAreaKeyword`](../type-aliases/TerrainAreaKeyword.md)[]

Defined in: [generated.ts:7638](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7638)

Terrain-area keywords areas of this template carry by default. Meaningful for `kind: "area"`.

***

### features?

> `optional` **features?**: [`ComposedFeature`](ComposedFeature.md)[]

Defined in: [generated.ts:7642](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7642)

Composed scenery features, in the area's centroid-local frame. Only meaningful for `kind: "area"`.

***

### terrain\_category?

> `optional` **terrain\_category?**: `"exposed"` \| `"light"` \| `"dense"`

Defined in: [generated.ts:7646](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7646)

11e terrain category (§13.02–13.05). Applies to kind: "feature". Dense features enable the Hidden rule; light features provide cover but not obscuring.

***

### walls?

> `optional` **walls?**: [`Wall`](Wall.md)[]

Defined in: [generated.ts:7650](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7650)

Wall polylines for this feature, in the same local frame as `footprint`. Meaningful for `kind: "feature"`.

***

### has\_roof?

> `optional` **has\_roof?**: `boolean`

Defined in: [generated.ts:7654](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7654)

Whether this feature has a roof. Meaningful for `kind: "feature"`.

***

### outline?

> `optional` **outline?**: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]

Defined in: [generated.ts:7660](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7660)

High-resolution boundary polygon for this template's base plate (the full die-cut nub outline). When present, rendering tools should prefer this over `footprint` for display; the resolver continues to use `footprint` for centroid and placement math. In the same local-inches frame as `footprint`.

#### Min Items

3

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:7661](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7661)
