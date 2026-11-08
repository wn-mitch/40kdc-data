[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ComposedFeature

# Interface: ComposedFeature

Defined in: [generated.ts:7568](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7568)

A feature placed on an area template, positioned in the area's centroid-local frame (y-down inches). When the area is placed, rotated, or mirrored, its composed features are carried along.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "composed-feature".

## Properties

### id?

> `optional` **id?**: `string`

Defined in: [generated.ts:7572](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7572)

Kebab-case identifier

***

### template

> **template**: `string`

Defined in: [generated.ts:7576](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7576)

Kebab-case identifier

***

### position

> **position**: [`Vec23`](Vec23.md)

Defined in: [generated.ts:7577](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7577)

***

### rotation\_degrees?

> `optional` **rotation\_degrees?**: `number`

Defined in: [generated.ts:7581](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7581)

Clockwise rotation of the feature about its own centroid, within the area-local frame.

***

### mirror?

> `optional` **mirror?**: `"none"` \| `"horizontal"` \| `"vertical"`

Defined in: [generated.ts:7582](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7582)

***

### floor?

> `optional` **floor?**: `number`

Defined in: [generated.ts:7586](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7586)

Ruin floor this feature occupies (0 = ground level).
