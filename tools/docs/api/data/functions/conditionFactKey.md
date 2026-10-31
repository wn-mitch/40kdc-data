[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / conditionFactKey

# Function: conditionFactKey()

> **conditionFactKey**(`condition`, `perspective`): `string`

Defined in: [cruncher/condition-facts.ts:44](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/condition-facts.ts#L44)

The key a leaf condition's declared answer goes under: the perspective, then the leaf's canonical
JSON. Unit references such as `this-unit` name a different unit from each perspective, so the
perspective is part of the key.

## Parameters

### condition

`Record`\<`string`, `unknown`\>

### perspective

[`TranslationPerspective`](../type-aliases/TranslationPerspective.md)

## Returns

`string`
