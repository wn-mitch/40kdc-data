[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedRegionProducer

# Interface: NamedRegionProducer

Defined in: [generated.ts:4643](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4643)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-region-producer".

## Properties

### region\_ref

> **region\_ref**: [`NamedRegionRef`](NamedRegionRef.md)

Defined in: [generated.ts:4644](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4644)

***

### mode

> **mode**: `"complete"` \| `"extension"`

Defined in: [generated.ts:4645](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4645)

***

### parent\_ref

> **parent\_ref**: [`NamedRegionRef`](NamedRegionRef.md) \| `null`

Defined in: [generated.ts:4646](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4646)

***

### baseline

> **baseline**: [`NamedRegionBaseline`](NamedRegionBaseline.md)[]

Defined in: [generated.ts:4647](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4647)

***

### phase\_extensions

> **phase\_extensions**: [`NamedRegionPhaseExtension`](NamedRegionPhaseExtension.md)[]

Defined in: [generated.ts:4648](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4648)

***

### additive\_extensions

> **additive\_extensions**: `object`[]

Defined in: [generated.ts:4649](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4649)

#### Index Signature

\[`k`: `string`\]: `unknown`

#### kind

> **kind**: `string`

#### source\_gate

> **source\_gate**: [`NamedRegionSourceGate`](NamedRegionSourceGate.md)

#### radius\_inches?

> `optional` **radius\_inches?**: `number`

#### activation?

> `optional` **activation?**: `object`

##### activation.event

> **event**: `"continuous"`
