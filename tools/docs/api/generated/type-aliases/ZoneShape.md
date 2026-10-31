[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ZoneShape

# Type Alias: ZoneShape

> **ZoneShape** = \{ `type`: `"rectangle"`; `width`: `number`; `height`: `number`; \} \| \{ `type`: `"polygon"`; `points`: \[[`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), `...Vec2[]`\]; \}

Defined in: [generated.ts:648](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L648)

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
