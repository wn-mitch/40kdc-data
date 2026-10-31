[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / conditionNeeds

# Function: conditionNeeds()

> **conditionNeeds**(`condition`, `perspective`, `evaluate`): [`ConditionNeed`](../type-aliases/ConditionNeed.md)[]

Defined in: [cruncher/condition-facts.ts:53](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/condition-facts.ts#L53)

The leaves of `condition` that leave it undecided, deduplicated by key in first-seen order.
`evaluate` is the engine's evaluator; a compound recurses into each operand that evaluates
`"unknown"`, so an `and` already decided by a false operand contributes nothing.

## Parameters

### condition

`Record`\<`string`, `unknown`\>

### perspective

[`TranslationPerspective`](../type-aliases/TranslationPerspective.md)

### evaluate

(`condition`) => `boolean` \| `"unknown"`

## Returns

[`ConditionNeed`](../type-aliases/ConditionNeed.md)[]
