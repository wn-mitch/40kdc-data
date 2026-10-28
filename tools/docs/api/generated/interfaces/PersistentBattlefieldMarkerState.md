[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PersistentBattlefieldMarkerState

# Interface: PersistentBattlefieldMarkerState

Defined in: [generated.ts:7973](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7973)

A marker placed on the battlefield that persists after placement: matching units may set up near it, using it may consume it, and enemy proximity removes it. Distinct from `tracking-token`, which is a reminder co-located with a model rather than a placed battlefield object with its own lifecycle.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "persistent-battlefield-marker-state".

## Properties

### marker\_label

> **marker\_label**: `string`

Defined in: [generated.ts:7974](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7974)

***

### placement

> **placement**: `"battlefield"` \| `"bearer"` \| `"bearer-unit"`

Defined in: [generated.ts:7978](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7978)

Where the marker is placed at the moment the ability resolves.

***

### setup\_keywords?

> `optional` **setup\_keywords?**: [`KeywordList13`](../type-aliases/KeywordList13.md)

Defined in: [generated.ts:7979](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7979)

***

### consume?

> `optional` **consume?**: `"on-use"` \| `"never"`

Defined in: [generated.ts:7983](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7983)

Whether a single set-up use spends the marker.

***

### setup\_within?

> `optional` **setup\_within?**: [`RangeRef`](../type-aliases/RangeRef.md)

Defined in: [generated.ts:7984](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7984)

***

### removed\_by\_enemy\_within?

> `optional` **removed\_by\_enemy\_within?**: [`RangeRef`](../type-aliases/RangeRef.md)

Defined in: [generated.ts:7985](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7985)
