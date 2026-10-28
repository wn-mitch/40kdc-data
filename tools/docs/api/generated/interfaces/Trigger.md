[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Trigger

# Interface: Trigger

Defined in: [generated.ts:4497](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4497)

A single reactive trigger: an event family (`event`), who acted (`subject`, default this-unit; clock events have none), what the action was aimed at (`object`), which one (`filter`: the move, roll, Stratagem or ability), a spatial gate (`proximity`), an extra gate (`condition`, where phase and turn go), `optional` for 'you can' reactions, a CP `cost`, and the `window` a granted reaction stays open.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "trigger".

## Properties

### event

> **event**: [`GameEvent`](../type-aliases/GameEvent.md)

Defined in: [generated.ts:4498](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4498)

***

### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4499](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4499)

***

### object?

> `optional` **object?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4500](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4500)

***

### filter?

> `optional` **filter?**: [`EventFilter`](EventFilter.md)

Defined in: [generated.ts:4501](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4501)

***

### proximity?

> `optional` **proximity?**: `object`

Defined in: [generated.ts:4505](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4505)

The event happened within range of `of` (default this-unit).

#### of?

> `optional` **of?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

***

### condition?

> `optional` **condition?**: [`AbilityDSLCondition1`](../type-aliases/AbilityDSLCondition1.md)

Defined in: [generated.ts:4509](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4509)

***

### optional?

> `optional` **optional?**: `boolean`

Defined in: [generated.ts:4510](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4510)

***

### cost?

> `optional` **cost?**: `object`

Defined in: [generated.ts:4511](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4511)

#### cp?

> `optional` **cp?**: `number`

***

### window?

> `optional` **window?**: `string`

Defined in: [generated.ts:4514](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4514)

***

### binds\_event\_variable?

> `optional` **binds\_event\_variable?**: `string`

Defined in: [generated.ts:4515](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4515)

***

### binds\_die\_variable?

> `optional` **binds\_die\_variable?**: `string`

Defined in: [generated.ts:4519](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4519)

Binds the generated Miracle die identity from a resource-generation trigger; consumers refer only as {die_var: ID}.

***

### binds\_selected\_die\_variable?

> `optional` **binds\_selected\_die\_variable?**: `string`

Defined in: [generated.ts:4523](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4523)

Binds the controller-selected Miracle die among those used in the triggering Act of Faith; consumers refer only as {die_var: ID}.

***

### source\_ability?

> `optional` **source\_ability?**: `object`

Defined in: [generated.ts:4527](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4527)

The ability whose selection fired a `targets-selected {kind: ability}` trigger. Required there and allowed nowhere else.

#### ability\_id

> **ability\_id**: `string`

#### owner

> **owner**: `"friendly"` \| `"enemy"` \| `"any"`

A definite player: friendly or enemy (an owner other than any).

#### keywords

> **keywords**: \[`string`, `...string[]`\]

All keywords required on the unit using the named source ability, not on the selected target.

##### Min Items

1
