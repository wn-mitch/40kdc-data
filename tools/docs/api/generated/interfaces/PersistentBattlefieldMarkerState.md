[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PersistentBattlefieldMarkerState

# Interface: PersistentBattlefieldMarkerState

Defined in: [generated.ts:7252](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7252)

A marker placed on the battlefield that persists after placement: matching units may set up near it, using it may consume it, and enemy proximity removes it. Distinct from `tracking-token`, which is a reminder co-located with a model rather than a placed battlefield object with its own lifecycle.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "persistent-battlefield-marker-state".

## Properties

### marker\_label

> **marker\_label**: `string`

Defined in: [generated.ts:7253](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7253)

***

### placement

> **placement**: `"battlefield"` \| `"bearer"` \| `"bearer-unit"`

Defined in: [generated.ts:7257](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7257)

Where the marker is placed at the moment the ability resolves.

***

### setup\_keywords?

> `optional` **setup\_keywords?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:7263](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7263)

When present, only units carrying every listed keyword may use the marker to set up; absent means any friendly unit.

#### Min Items

1

***

### consume?

> `optional` **consume?**: `"on-use"` \| `"never"`

Defined in: [generated.ts:7267](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7267)

Whether a single set-up use spends the marker.

***

### setup\_within?

> `optional` **setup\_within?**: [`RangeRef`](../type-aliases/RangeRef.md)

Defined in: [generated.ts:7268](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7268)

***

### removed\_by\_enemy\_within?

> `optional` **removed\_by\_enemy\_within?**: [`RangeRef`](../type-aliases/RangeRef.md)

Defined in: [generated.ts:7269](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7269)
