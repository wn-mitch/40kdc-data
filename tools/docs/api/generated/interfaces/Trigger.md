[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Trigger

# Interface: Trigger

Defined in: [generated.ts:3992](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3992)

A single reactive trigger: an event family (`event`), who acted (`subject`, default this-unit; clock events have none), what the action was aimed at (`object`), which one (`filter`: the move, roll, Stratagem or ability), a spatial gate (`proximity`), an extra gate (`condition`, where phase and turn go), `optional` for 'you can' reactions, a CP `cost`, and the `window` a granted reaction stays open.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "trigger".

## Properties

### event

> **event**: [`GameEvent`](../type-aliases/GameEvent.md)

Defined in: [generated.ts:3993](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3993)

***

### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3994](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3994)

***

### object?

> `optional` **object?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3995](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3995)

***

### filter?

> `optional` **filter?**: [`EventFilter`](EventFilter.md)

Defined in: [generated.ts:3996](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3996)

***

### proximity?

> `optional` **proximity?**: `object`

Defined in: [generated.ts:4000](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4000)

The event happened within range of `of` (default this-unit).

#### of?

> `optional` **of?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

***

### condition?

> `optional` **condition?**: [`AbilityDSLCondition1`](../type-aliases/AbilityDSLCondition1.md)

Defined in: [generated.ts:4004](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4004)

***

### optional?

> `optional` **optional?**: `boolean`

Defined in: [generated.ts:4005](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4005)

***

### cost?

> `optional` **cost?**: `object`

Defined in: [generated.ts:4006](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4006)

#### cp?

> `optional` **cp?**: `number`

***

### window?

> `optional` **window?**: `string`

Defined in: [generated.ts:4009](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4009)

***

### binds\_event\_variable?

> `optional` **binds\_event\_variable?**: `string`

Defined in: [generated.ts:4010](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4010)

***

### binds\_die\_variable?

> `optional` **binds\_die\_variable?**: `string`

Defined in: [generated.ts:4014](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4014)

Binds the generated Miracle die identity from a resource-generation trigger; consumers refer only as {die_var: ID}.

***

### binds\_selected\_die\_variable?

> `optional` **binds\_selected\_die\_variable?**: `string`

Defined in: [generated.ts:4018](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4018)

Binds the controller-selected Miracle die among those used in the triggering Act of Faith; consumers refer only as {die_var: ID}.

***

### source\_ability?

> `optional` **source\_ability?**: `object`

Defined in: [generated.ts:4022](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4022)

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
