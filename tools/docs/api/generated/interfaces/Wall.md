[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Wall

# Interface: Wall

Defined in: [generated.ts:1270](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1270)

A wall polyline: an open path of 2+ vertices with optional thickness, in the same local frame as the footprint.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wall".

## Properties

### points

> **points**: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]

Defined in: [generated.ts:1274](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1274)

#### Min Items

2

***

### thickness?

> `optional` **thickness?**: `number`

Defined in: [generated.ts:1278](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1278)

Wall thickness in inches. Omit for thin walls.
