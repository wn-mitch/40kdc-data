[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedRegionProducer

# Interface: NamedRegionProducer

Defined in: [generated.ts:4460](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4460)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-region-producer".

## Properties

### region\_ref

> **region\_ref**: [`NamedRegionRef`](NamedRegionRef.md)

Defined in: [generated.ts:4461](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4461)

***

### mode

> **mode**: `"complete"` \| `"extension"`

Defined in: [generated.ts:4462](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4462)

***

### parent\_ref

> **parent\_ref**: [`NamedRegionRef`](NamedRegionRef.md) \| `null`

Defined in: [generated.ts:4463](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4463)

***

### baseline

> **baseline**: [`NamedRegionBaseline`](NamedRegionBaseline.md)[]

Defined in: [generated.ts:4464](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4464)

***

### phase\_extensions

> **phase\_extensions**: [`NamedRegionPhaseExtension`](NamedRegionPhaseExtension.md)[]

Defined in: [generated.ts:4465](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4465)

***

### additive\_extensions

> **additive\_extensions**: `object`[]

Defined in: [generated.ts:4466](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4466)

#### kind

> **kind**: `"unit-proximity"`

#### filter

> **filter**: [`UnitFilter`](UnitFilter.md)

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)
