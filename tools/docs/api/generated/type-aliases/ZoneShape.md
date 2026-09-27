[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ZoneShape

# Type Alias: ZoneShape

> **ZoneShape** = \{ `type`: `"rectangle"`; `width`: `number`; `height`: `number`; \} \| \{ `type`: `"polygon"`; `points`: \[[`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), `...Vec2[]`\]; \}

Defined in: [generated.ts:332](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L332)

A zone footprint, expressed as an axis-aligned rectangle or an explicit polygon. Vertices/extent are relative to the owning element's position.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "zone-shape".

## Union Members

### Type Literal

\{ `type`: `"rectangle"`; `width`: `number`; `height`: `number`; \}

***

### Type Literal

\{ `type`: `"polygon"`; `points`: \[[`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), `...Vec2[]`\]; \}

#### type

> **type**: `"polygon"`

#### points

> **points**: \[[`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), `...Vec2[]`\]

##### Min Items

3
