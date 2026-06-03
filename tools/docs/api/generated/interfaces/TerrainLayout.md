[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TerrainLayout

# Interface: TerrainLayout

Defined in: [generated.ts:1014](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1014)

A recommended arrangement of terrain pieces on the board, independent of the deployment map (a deployment-pattern references the layouts it recommends via recommended_terrain_layout_ids). Each piece draws its geometry from a catalog `template` (a terrain-template entity) or an inline `footprint`; geometry is the source of truth. Placement is template-centroid-anchored: `position` is the piece's centroid, which is invariant under rotation and mirror, so orientation and location are decoupled. Resolved board-space vertices are derived by the shared terrain resolver (pinned by the conformance corpus), never stored here. No layout data is authored yet beyond migrated examples.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "terrain-layout".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:1015](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1015)

***

### name

> **name**: `string`

Defined in: [generated.ts:1016](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1016)

***

### source?

> `optional` **source?**: `string`

Defined in: [generated.ts:1020](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1020)

Mission pack or source the layout originates from.

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:1021](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1021)

***

### pieces?

> `optional` **pieces?**: [`Piece`](Piece.md)[]

Defined in: [generated.ts:1025](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1025)

Terrain pieces composing the layout. May be empty while a layout is registered by name ahead of its confirmed geometry.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1026](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1026)
