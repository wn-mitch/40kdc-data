[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Trigger1

# Interface: Trigger1

Defined in: [generated.ts:7183](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7183)

A single reactive trigger: an event family (`event`), who acted (`subject`, default this-unit; clock events have none), what the action was aimed at (`object`), which one (`filter`: the move, roll, Stratagem or ability), a spatial gate (`proximity`), an extra gate (`condition`, where phase and turn go), `optional` for 'you can' reactions, a CP `cost`, and the `window` a granted reaction stays open.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "resource-action-menu-trigger".

## Properties

### event

> **event**: [`GameEvent`](../type-aliases/GameEvent.md)

Defined in: [generated.ts:7184](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7184)

***

### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:7185](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7185)

***

### object?

> `optional` **object?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:7186](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7186)

***

### filter?

> `optional` **filter?**: [`EventFilter`](EventFilter.md)

Defined in: [generated.ts:7187](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7187)

***

### proximity?

> `optional` **proximity?**: `object`

Defined in: [generated.ts:7191](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7191)

The event happened within range of `of` (default this-unit).

#### of?

> `optional` **of?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

***

### condition?

> `optional` **condition?**: [`AbilityDSLCondition1`](../type-aliases/AbilityDSLCondition1.md)

Defined in: [generated.ts:7195](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7195)

***

### optional?

> `optional` **optional?**: `boolean`

Defined in: [generated.ts:7196](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7196)

***

### cost?

> `optional` **cost?**: `object`

Defined in: [generated.ts:7197](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7197)

#### cp?

> `optional` **cp?**: `number`

***

### window?

> `optional` **window?**: `string`

Defined in: [generated.ts:7200](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7200)

***

### binds\_event\_variable?

> `optional` **binds\_event\_variable?**: `string`

Defined in: [generated.ts:7201](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7201)

***

### binds\_die\_variable?

> `optional` **binds\_die\_variable?**: `string`

Defined in: [generated.ts:7205](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7205)

Binds the generated Miracle die identity from a resource-generation trigger; consumers refer only as {die_var: ID}.

***

### binds\_selected\_die\_variable?

> `optional` **binds\_selected\_die\_variable?**: `string`

Defined in: [generated.ts:7209](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7209)

Binds the controller-selected Miracle die among those used in the triggering Act of Faith; consumers refer only as {die_var: ID}.

***

### source\_ability?

> `optional` **source\_ability?**: `object`

Defined in: [generated.ts:7213](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7213)

The ability whose selection fired a `targets-selected {kind: ability}` trigger. Required there and allowed nowhere else.

#### ability\_id

> **ability\_id**: `string`

#### owner

> **owner**: `"friendly"` \| `"enemy"`

#### keywords

> **keywords**: \[`string`, `...string[]`\]

All keywords required on the unit using the named source ability, not on the selected target.

##### Min Items

1
