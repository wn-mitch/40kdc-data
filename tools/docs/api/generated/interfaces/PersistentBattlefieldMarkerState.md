[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PersistentBattlefieldMarkerState

# Interface: PersistentBattlefieldMarkerState

Defined in: [generated.ts:8513](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8513)

A marker placed on the battlefield that persists after placement: matching units may set up near it, using it may consume it, and enemy proximity removes it. Distinct from `tracking-token`, which is a reminder co-located with a model rather than a placed battlefield object with its own lifecycle.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "persistent-battlefield-marker-state".

## Properties

### marker\_label

> **marker\_label**: `string`

Defined in: [generated.ts:8514](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8514)

***

### placement

> **placement**: `"battlefield"` \| `"bearer"` \| `"bearer-unit"`

Defined in: [generated.ts:8518](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8518)

Where the marker is placed at the moment the ability resolves.

***

### setup\_keywords?

> `optional` **setup\_keywords?**: [`KeywordList15`](../type-aliases/KeywordList15.md)

Defined in: [generated.ts:8519](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8519)

***

### consume?

> `optional` **consume?**: `"on-use"` \| `"never"`

Defined in: [generated.ts:8523](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8523)

Whether a single set-up use spends the marker.

***

### setup\_within?

> `optional` **setup\_within?**: [`RangeRef`](../type-aliases/RangeRef.md)

Defined in: [generated.ts:8524](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8524)

***

### removed\_by\_enemy\_within?

> `optional` **removed\_by\_enemy\_within?**: [`RangeRef`](../type-aliases/RangeRef.md)

Defined in: [generated.ts:8525](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8525)
