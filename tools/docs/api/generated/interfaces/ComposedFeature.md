[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ComposedFeature

# Interface: ComposedFeature

Defined in: [generated.ts:6355](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6355)

A feature placed on an area template, positioned in the area's centroid-local frame (y-down inches). When the area is placed, rotated, or mirrored, its composed features are carried along.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "composed-feature".

## Properties

### id?

> `optional` **id?**: `string`

Defined in: [generated.ts:6359](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6359)

Kebab-case identifier

***

### template

> **template**: `string`

Defined in: [generated.ts:6363](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6363)

Kebab-case identifier

***

### position

> **position**: [`Vec23`](Vec23.md)

Defined in: [generated.ts:6364](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6364)

***

### rotation\_degrees?

> `optional` **rotation\_degrees?**: `number`

Defined in: [generated.ts:6368](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6368)

Clockwise rotation of the feature about its own centroid, within the area-local frame.

***

### mirror?

> `optional` **mirror?**: `"none"` \| `"horizontal"` \| `"vertical"`

Defined in: [generated.ts:6369](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6369)

***

### floor?

> `optional` **floor?**: `number`

Defined in: [generated.ts:6373](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6373)

Ruin floor this feature occupies (0 = ground level).
