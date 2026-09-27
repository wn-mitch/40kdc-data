[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ComposedFeature

# Interface: ComposedFeature

Defined in: [generated.ts:3651](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3651)

A feature placed on an area template, positioned in the area's centroid-local frame (y-down inches). When the area is placed, rotated, or mirrored, its composed features are carried along.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "composed-feature".

## Properties

### id?

> `optional` **id?**: `string`

Defined in: [generated.ts:3655](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3655)

Kebab-case identifier

***

### template

> **template**: `string`

Defined in: [generated.ts:3659](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3659)

Kebab-case identifier

***

### position

> **position**: [`Vec23`](Vec23.md)

Defined in: [generated.ts:3660](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3660)

***

### rotation\_degrees?

> `optional` **rotation\_degrees?**: `number`

Defined in: [generated.ts:3664](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3664)

Clockwise rotation of the feature about its own centroid, within the area-local frame.

***

### mirror?

> `optional` **mirror?**: `"none"` \| `"horizontal"` \| `"vertical"`

Defined in: [generated.ts:3665](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3665)

***

### floor?

> `optional` **floor?**: `number`

Defined in: [generated.ts:3669](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3669)

Ruin floor this feature occupies (0 = ground level).
