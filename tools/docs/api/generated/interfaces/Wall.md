[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Wall

# Interface: Wall

Defined in: [generated.ts:1241](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1241)

A wall polyline: an open path of 2+ vertices with optional thickness, in the same local frame as the footprint.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wall".

## Properties

### points

> **points**: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]

Defined in: [generated.ts:1245](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1245)

#### Min Items

2

***

### thickness?

> `optional` **thickness?**: `number`

Defined in: [generated.ts:1249](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1249)

Wall thickness in inches. Omit for thin walls.
