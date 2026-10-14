[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DiceGatedEffect

# Type Alias: DiceGatedEffect

> **DiceGatedEffect** = `object` & `object`

Defined in: [generated.ts:815](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L815)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "dice-gated-effect".

## Type Declaration

### type

> **type**: `"dice-gated"`

### dice?

> `optional` **dice?**: [`DiceExpression`](DiceExpression.md)

### threshold?

> `optional` **threshold?**: `number` \| `"leadership"` \| `"toughness"` \| `"save"`

Fixed threshold or model characteristic to compare against

### comparison?

> `optional` **comparison?**: `"gte"` \| `"lte"` \| `"gt"` \| `"lt"` \| `"eq"`

### on\_success?

> `optional` **on\_success?**: [`EffectNode`](EffectNode.md) \| `null`

### on\_fail?

> `optional` **on\_fail?**: [`EffectNode`](EffectNode.md) \| `null`

### rider?

> `optional` **rider?**: `boolean`

Marks this gate as the RIDER half of a roll-with-rider composition: a `sequence` whose first step is this gate and whose second step is the unconditional primary. The gate's effect fires on the roll and the primary resolves regardless, so the sequence renders with a mandatory "Regardless of the result" clause. Structurally identical to a real gate (a `dice-gated` with `on_success` and no `on_fail`), which is why the distinction is declared rather than inferred.

### test?

> `optional` **test?**: `object`

Perform the named actual 2D6 test using the subject's current Leadership and normal applicable modifiers and reroll permissions. A Battle-shock failure inflicts Battle-shock as well as resolving on_fail; a Leadership test does not.

#### test.kind

> **kind**: `"leadership"` \| `"battle-shock"`

#### test.subject

> **subject**: [`UnitRef`](UnitRef.md)

#### test.modifiers?

> `optional` **modifiers?**: \[\{ `condition`: [`AbilityDSLCondition1`](AbilityDSLCondition1.md); `value`: `number`; \}, `...{ condition: AbilityDSLCondition1; value: number }[]`\]

##### Min Items

1

### from?

> `optional` **from?**: [`RollReference1`](../interfaces/RollReference1.md)

### requirement?

> `optional` **requirement?**: [`DiceRequirement`](../interfaces/DiceRequirement.md) \| \{ `any_of`: \[[`DiceRequirement`](../interfaces/DiceRequirement.md), [`DiceRequirement`](../interfaces/DiceRequirement.md), `...DiceRequirement[]`\]; \}

With `from`: succeeds when the bound roll's unused dice form this pair, triple or run; those dice are then used up.

#### Union Members

[`DiceRequirement`](../interfaces/DiceRequirement.md)

***

##### Type Literal

\{ `any_of`: \[[`DiceRequirement`](../interfaces/DiceRequirement.md), [`DiceRequirement`](../interfaces/DiceRequirement.md), `...DiceRequirement[]`\]; \}

##### any\_of

> **any\_of**: \[[`DiceRequirement`](../interfaces/DiceRequirement.md), [`DiceRequirement`](../interfaces/DiceRequirement.md), `...DiceRequirement[]`\]

###### Min Items

2

### kind?

> `optional` **kind?**: `"hit"` \| `"wound"` \| `"save"` \| `"damage"` \| `"charge"` \| `"advance"` \| `"battle-shock"` \| `"leadership"` \| `"hazard"` \| `"psychic"` \| `"desperate-escape"` \| `"dark-pact"` \| `"blessings-of-khorne"` \| `"manoeuvre"` \| `"channelling"` \| `"deadly-demise"` \| `"attacks"` \| `"normal-move"` \| `"surge"` \| `"resource-die"` \| [`AbilityRoll`](../interfaces/AbilityRoll.md)

Which roll this is (a Psychic test), so modifiers and re-rolls to that roll apply.
