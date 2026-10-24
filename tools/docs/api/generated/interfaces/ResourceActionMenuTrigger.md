[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceActionMenuTrigger

# Interface: ResourceActionMenuTrigger

Defined in: [generated.ts:3881](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3881)

A single reactive trigger: an event family (`event`), who acted (`subject`, default this-unit; clock events have none), what the action was aimed at (`object`), which one (`filter`: the move, roll, Stratagem or ability), a spatial gate (`proximity`), an extra gate (`condition`, where phase and turn go), `optional` for 'you can' reactions, a CP `cost`, and the `window` a granted reaction stays open.

## Properties

### event

> **event**: [`GameEvent`](../type-aliases/GameEvent.md)

Defined in: [generated.ts:3882](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3882)

***

### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3883](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3883)

***

### object?

> `optional` **object?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3884](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3884)

***

### filter?

> `optional` **filter?**: [`EventFilter`](EventFilter.md)

Defined in: [generated.ts:3885](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3885)

***

### proximity?

> `optional` **proximity?**: `object`

Defined in: [generated.ts:3889](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3889)

The event happened within range of `of` (default this-unit).

#### of?

> `optional` **of?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

***

### condition?

> `optional` **condition?**: [`AbilityDSLCondition1`](../type-aliases/AbilityDSLCondition1.md)

Defined in: [generated.ts:3893](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3893)

***

### optional?

> `optional` **optional?**: `boolean`

Defined in: [generated.ts:3894](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3894)

***

### cost?

> `optional` **cost?**: `object`

Defined in: [generated.ts:3895](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3895)

#### cp?

> `optional` **cp?**: `number`

***

### window?

> `optional` **window?**: `string`

Defined in: [generated.ts:3898](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3898)

***

### binds\_event\_variable?

> `optional` **binds\_event\_variable?**: `string`

Defined in: [generated.ts:3899](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3899)

***

### binds\_die\_variable?

> `optional` **binds\_die\_variable?**: `string`

Defined in: [generated.ts:3903](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3903)

Binds the generated Miracle die identity from a resource-generation trigger; consumers refer only as {die_var: ID}.

***

### binds\_selected\_die\_variable?

> `optional` **binds\_selected\_die\_variable?**: `string`

Defined in: [generated.ts:3907](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3907)

Binds the controller-selected Miracle die among those used in the triggering Act of Faith; consumers refer only as {die_var: ID}.

***

### source\_ability?

> `optional` **source\_ability?**: `object`

Defined in: [generated.ts:3911](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3911)

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
