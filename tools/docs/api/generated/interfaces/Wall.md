[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Wall

# Interface: Wall

Defined in: [generated.ts:1222](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1222)

A wall polyline: an open path of 2+ vertices with optional thickness, in the same local frame as the footprint.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wall".

## Properties

### points

> **points**: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]

Defined in: [generated.ts:1226](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1226)

#### Min Items

2

***

### thickness?

> `optional` **thickness?**: `number`

Defined in: [generated.ts:1230](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1230)

Wall thickness in inches. Omit for thin walls.
