[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedRegionState

# Interface: NamedRegionState

Defined in: [generated.ts:4442](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4442)

A named region an army rule produces and, with a consumer, what it does for units inside it. Without a consumer it only declares the region, for other rules to name through rule_region; branch_precedence then has no branches to order.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-region-state".

## Properties

### region\_ref

> **region\_ref**: [`NamedRegionRef`](NamedRegionRef.md)

Defined in: [generated.ts:4443](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4443)

***

### producer

> **producer**: [`NamedRegionProducer`](NamedRegionProducer.md)

Defined in: [generated.ts:4444](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4444)

***

### consumer?

> `optional` **consumer?**: [`NamedRegionConsumer`](NamedRegionConsumer.md)

Defined in: [generated.ts:4445](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4445)

***

### branch\_precedence?

> `optional` **branch\_precedence?**: `"qualified-replaces-default"`

Defined in: [generated.ts:4446](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4446)
