[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedRegionState

# Interface: NamedRegionState

Defined in: [generated.ts:4671](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4671)

A named region an army rule produces and, with a consumer, what it does for units inside it. Without a consumer it only declares the region, for other rules to name through rule_region; branch_precedence then has no branches to order.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-region-state".

## Properties

### region\_ref

> **region\_ref**: [`NamedRegionRef`](NamedRegionRef.md)

Defined in: [generated.ts:4672](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4672)

***

### producer

> **producer**: [`NamedRegionProducer`](NamedRegionProducer.md)

Defined in: [generated.ts:4673](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4673)

***

### consumer?

> `optional` **consumer?**: [`NamedRegionConsumer`](NamedRegionConsumer.md)

Defined in: [generated.ts:4674](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4674)

***

### branch\_precedence?

> `optional` **branch\_precedence?**: `"qualified-replaces-default"`

Defined in: [generated.ts:4675](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4675)
