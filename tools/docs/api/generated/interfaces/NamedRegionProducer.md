[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedRegionProducer

# Interface: NamedRegionProducer

Defined in: [generated.ts:4689](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4689)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-region-producer".

## Properties

### region\_ref

> **region\_ref**: [`NamedRegionRef`](NamedRegionRef.md)

Defined in: [generated.ts:4690](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4690)

***

### mode

> **mode**: `"complete"` \| `"extension"`

Defined in: [generated.ts:4691](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4691)

***

### parent\_ref

> **parent\_ref**: [`NamedRegionRef`](NamedRegionRef.md) \| `null`

Defined in: [generated.ts:4692](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4692)

***

### baseline

> **baseline**: [`NamedRegionBaseline`](NamedRegionBaseline.md)[]

Defined in: [generated.ts:4693](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4693)

***

### phase\_extensions

> **phase\_extensions**: [`NamedRegionPhaseExtension`](NamedRegionPhaseExtension.md)[]

Defined in: [generated.ts:4694](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4694)

***

### additive\_extensions

> **additive\_extensions**: `object`[]

Defined in: [generated.ts:4695](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4695)

#### kind

> **kind**: `"unit-proximity"`

#### filter

> **filter**: [`UnitFilter`](UnitFilter.md)

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)
