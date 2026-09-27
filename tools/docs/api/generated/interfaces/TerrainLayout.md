[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TerrainLayout

# Interface: TerrainLayout

Defined in: [generated.ts:3612](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3612)

A recommended arrangement of terrain pieces on the board, independent of the deployment map (a deployment-pattern references the layouts it recommends via recommended_terrain_layout_ids). Each piece draws its geometry from a catalog `template` (a terrain-template entity) or an inline `footprint`; geometry is the source of truth. Placement is template-centroid-anchored: `position` is the piece's centroid, which is invariant under rotation and mirror, so orientation and location are decoupled. Resolved board-space vertices are derived by the shared terrain resolver (pinned by the conformance corpus), never stored here. No layout data is authored yet beyond migrated examples.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "terrain-layout".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3613](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3613)

***

### name

> **name**: `string`

Defined in: [generated.ts:3614](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3614)

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:3618](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3618)

Mission pack or source the layout originates from.

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:3619](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3619)

***

### mission\_matchup\_id?

> `optional` **mission\_matchup\_id?**: `string`

Defined in: [generated.ts:3623](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3623)

Kebab-case identifier

***

### variant?

> `optional` **variant?**: `number`

Defined in: [generated.ts:3627](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3627)

The card's trailing variant number within its mission matchup (1–3 at launch, since three layouts share each pairing). No hard maximum, to avoid a breaking change if more variants ship.

***

### deployment\_pattern\_id?

> `optional` **deployment\_pattern\_id?**: `string`

Defined in: [generated.ts:3631](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3631)

Kebab-case identifier

***

### board?

> `optional` **board?**: `object`

Defined in: [generated.ts:3635](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3635)

Board extents in inches (y-down). Absent means the 40kdc standard 60×44. A per-layout override for one-off boards (e.g. the 36×36 KOTC colosseum); resolver geometry is board-agnostic, so consumers use this only to size the table.

#### width

> **width**: `number`

#### height

> **height**: `number`

***

### pieces?

> `optional` **pieces?**: [`Piece`](Piece.md)[]

Defined in: [generated.ts:3642](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3642)

Terrain pieces composing the layout. May be empty while a layout is registered by name ahead of its confirmed geometry.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3643](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3643)
