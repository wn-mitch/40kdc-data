[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedRegionProducer

# Interface: NamedRegionProducer

Defined in: [generated.ts:3955](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3955)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-region-producer".

## Properties

### region\_ref

> **region\_ref**: [`NamedRegionRef`](NamedRegionRef.md)

Defined in: [generated.ts:3956](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3956)

***

### mode

> **mode**: `"complete"` \| `"extension"`

Defined in: [generated.ts:3957](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3957)

***

### parent\_ref

> **parent\_ref**: [`NamedRegionRef`](NamedRegionRef.md) \| `null`

Defined in: [generated.ts:3958](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3958)

***

### baseline

> **baseline**: [`NamedRegionBaseline`](NamedRegionBaseline.md)[]

Defined in: [generated.ts:3959](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3959)

***

### phase\_extensions

> **phase\_extensions**: [`NamedRegionPhaseExtension`](NamedRegionPhaseExtension.md)[]

Defined in: [generated.ts:3960](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3960)

***

### additive\_extensions

> **additive\_extensions**: `object`[]

Defined in: [generated.ts:3961](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3961)

#### kind

> **kind**: `"unit-proximity"`

#### filter

> **filter**: [`UnitFilter`](UnitFilter.md)

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)
