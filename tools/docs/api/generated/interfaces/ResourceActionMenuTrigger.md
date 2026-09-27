[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceActionMenuTrigger

# Interface: ResourceActionMenuTrigger

Defined in: [generated.ts:3015](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3015)

A single reactive trigger: an event family (`event`), who acted (`subject`, default this-unit; clock events have none), what the action was aimed at (`object`), which one (`filter`: the move, roll, Stratagem or ability), a spatial gate (`proximity`), an extra gate (`condition`, where phase and turn go), `optional` for 'you can' reactions, a CP `cost`, and the `window` a granted reaction stays open.

## Properties

### event

> **event**: [`GameEvent`](../type-aliases/GameEvent.md)

Defined in: [generated.ts:3016](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3016)

***

### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3017](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3017)

***

### object?

> `optional` **object?**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3018](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3018)

***

### filter?

> `optional` **filter?**: [`EventFilter`](EventFilter.md)

Defined in: [generated.ts:3019](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3019)

***

### proximity?

> `optional` **proximity?**: `object`

Defined in: [generated.ts:3023](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3023)

The event happened within range of `of` (default this-unit).

#### of?

> `optional` **of?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

***

### condition?

> `optional` **condition?**: [`AbilityDSLCondition2`](../type-aliases/AbilityDSLCondition2.md)

Defined in: [generated.ts:3027](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3027)

***

### optional?

> `optional` **optional?**: `boolean`

Defined in: [generated.ts:3028](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3028)

***

### cost?

> `optional` **cost?**: `object`

Defined in: [generated.ts:3029](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3029)

#### cp?

> `optional` **cp?**: `number`

***

### window?

> `optional` **window?**: `string`

Defined in: [generated.ts:3032](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3032)

***

### binds\_event\_variable?

> `optional` **binds\_event\_variable?**: `string`

Defined in: [generated.ts:3033](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3033)

***

### binds\_die\_variable?

> `optional` **binds\_die\_variable?**: `string`

Defined in: [generated.ts:3037](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3037)

Binds the generated Miracle die identity from a resource-generation trigger; consumers refer only as {die_var: ID}.

***

### binds\_selected\_die\_variable?

> `optional` **binds\_selected\_die\_variable?**: `string`

Defined in: [generated.ts:3041](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3041)

Binds the controller-selected Miracle die among those used in the triggering Act of Faith; consumers refer only as {die_var: ID}.

***

### source\_ability?

> `optional` **source\_ability?**: `object`

Defined in: [generated.ts:3045](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3045)

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
