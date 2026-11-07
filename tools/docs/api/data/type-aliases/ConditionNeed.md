[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ConditionNeed

# Type Alias: ConditionNeed

> **ConditionNeed** = `object`

Defined in: [cruncher/condition-facts.ts:15](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/condition-facts.ts#L15)

One leaf condition the context cannot decide, with the key its declared answer goes under.

## Properties

### key

> **key**: `string`

Defined in: [cruncher/condition-facts.ts:17](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/condition-facts.ts#L17)

[conditionFactKey](../functions/conditionFactKey.md) of the leaf: the key [EngineContext.conditionFacts](EngineContext.md#conditionfacts) reads.

***

### condition

> **condition**: `Record`\<`string`, `unknown`\>

Defined in: [cruncher/condition-facts.ts:19](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/condition-facts.ts#L19)

The leaf condition as authored.

***

### perspective

> **perspective**: [`TranslationPerspective`](TranslationPerspective.md)

Defined in: [cruncher/condition-facts.ts:21](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/condition-facts.ts#L21)

The perspective the leaf was evaluated from; its unit references are relative to it.
