[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Footprint

# Type Alias: Footprint

> **Footprint** = \{ `type`: `"rectangle"`; `width`: `number`; `height`: `number`; \} \| \{ `type`: `"right-triangle"`; `width`: `number`; `height`: `number`; \} \| \{ `type`: `"polygon"`; `points`: \[[`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), `...Vec2[]`\]; \}

Defined in: [generated.ts:268](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L268)

A terrain piece's 2D footprint in local inches (y-down): an axis-aligned rectangle with its min corner at the local origin, a right triangle with the right angle at the local origin and legs along +x/+y, or an explicit polygon (>= 3 points). The placement resolver re-centers the footprint on its polygon area centroid, so the local-origin convention does not affect where the piece lands — only its shape matters.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "footprint".

## Union Members

### Type Literal

\{ `type`: `"rectangle"`; `width`: `number`; `height`: `number`; \}

***

### Type Literal

\{ `type`: `"right-triangle"`; `width`: `number`; `height`: `number`; \}

***

### Type Literal

\{ `type`: `"polygon"`; `points`: \[[`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), `...Vec2[]`\]; \}

#### type

> **type**: `"polygon"`

#### points

> **points**: \[[`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), [`Vec2`](../interfaces/Vec2.md), `...Vec2[]`\]

##### Min Items

3
