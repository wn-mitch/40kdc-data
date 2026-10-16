[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AuraEffect

# Interface: AuraEffect

Defined in: [generated.ts:3722](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3722)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "aura-effect".

## Properties

### type

> **type**: `"aura"`

Defined in: [generated.ts:3723](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3723)

***

### target

> **target**: `"enemy-within-aura"` \| `"friendly-within-aura"`

Defined in: [generated.ts:3724](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3724)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3725](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3725)

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### range\_bonus?

> `optional` **range\_bonus?**: `number`

#### of?

> `optional` **of?**: `string`

#### effect?

> `optional` **effect?**: [`EffectNode`](../type-aliases/EffectNode.md)

#### eligible?

> `optional` **eligible?**: [`UnitFilter`](UnitFilter.md)

#### emitter\_filter?

> `optional` **emitter\_filter?**: [`UnitFilter`](UnitFilter.md)

#### recipient\_filter?

> `optional` **recipient\_filter?**: [`UnitFilter`](UnitFilter.md)

#### range\_cap?

> `optional` **range\_cap?**: `number`

The aura range, extensions included, never exceeds this.

#### wholly?

> `optional` **wholly?**: `true`

The unit must be wholly within the range (no part of it outside), not merely within it (any part inside).
