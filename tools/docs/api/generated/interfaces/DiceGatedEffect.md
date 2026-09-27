[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DiceGatedEffect

# Interface: DiceGatedEffect

Defined in: [generated.ts:2497](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2497)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "dice-gated-effect".

## Indexable

> \[`k`: `string`\]: `unknown`

## Properties

### type

> **type**: `"dice-gated"`

Defined in: [generated.ts:2498](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2498)

***

### dice

> **dice**: `string`

Defined in: [generated.ts:2502](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2502)

Dice expression, e.g. 'D6', '2D6'

***

### threshold

> **threshold**: `number` \| `"save"` \| `"leadership"` \| `"toughness"`

Defined in: [generated.ts:2506](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2506)

Fixed threshold or model characteristic to compare against

***

### comparison?

> `optional` **comparison?**: `"gte"` \| `"lte"` \| `"gt"` \| `"lt"` \| `"eq"`

Defined in: [generated.ts:2507](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2507)

***

### on\_success?

> `optional` **on\_success?**: [`EffectNode`](../type-aliases/EffectNode.md) \| `null`

Defined in: [generated.ts:2508](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2508)

***

### on\_fail?

> `optional` **on\_fail?**: [`EffectNode`](../type-aliases/EffectNode.md) \| `null`

Defined in: [generated.ts:2509](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2509)

***

### rider?

> `optional` **rider?**: `boolean`

Defined in: [generated.ts:2513](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2513)

Marks this gate as the RIDER half of a roll-with-rider composition: a `sequence` whose first step is this gate and whose second step is the unconditional primary. The gate's effect fires on the roll and the primary resolves regardless, so the sequence renders with a mandatory "Regardless of the result" clause. Structurally identical to a real gate (a `dice-gated` with `on_success` and no `on_fail`), which is why the distinction is declared rather than inferred.

***

### test?

> `optional` **test?**: `object`

Defined in: [generated.ts:2517](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2517)

Perform the named actual 2D6 test using the subject's current Leadership and normal applicable modifiers and reroll permissions. A Battle-shock failure inflicts Battle-shock as well as resolving on_fail; a Leadership test does not.

#### kind

> **kind**: `"battle-shock"` \| `"leadership"`

#### subject

> **subject**: `"self"` \| `"unit"` \| `"target"`

#### modifiers?

> `optional` **modifiers?**: \[\{ `condition`: [`AbilityDSLCondition2`](../type-aliases/AbilityDSLCondition2.md); `value`: `number`; \}, `...{ condition: AbilityDSLCondition2; value: number }[]`\]

##### Min Items

1

***

### roll\_var?

> `optional` **roll\_var?**: `string`

Defined in: [generated.ts:2537](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2537)

Binds this D6 result for an immediate nested consumer; a consumer refers to it only as {roll_var: ID}.
