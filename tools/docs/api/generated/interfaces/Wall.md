[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Wall

# Interface: Wall

Defined in: [generated.ts:894](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L894)

A wall polyline: an open path of 2+ vertices with optional thickness, in the same local frame as the footprint.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wall".

## Properties

### points

> **points**: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]

Defined in: [generated.ts:898](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L898)

#### Min Items

2

***

### thickness?

> `optional` **thickness?**: `number`

Defined in: [generated.ts:902](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L902)

Wall thickness in inches. Omit for thin walls.
