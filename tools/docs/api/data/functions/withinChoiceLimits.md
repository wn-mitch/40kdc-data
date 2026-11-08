[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / withinChoiceLimits

# Function: withinChoiceLimits()

> **withinChoiceLimits**\<`T`\>(`selected`): `T`[]

Defined in: [cruncher/mortal-sources.ts:265](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/mortal-sources.ts#L265)

The sources a selection keeps, in its order: a source whose option would take an enclosing
choice past its limit of options is left out. Sources under one option share its pick.

## Type Parameters

### T

`T` *extends* `Pick`\<[`MortalWoundSource`](../type-aliases/MortalWoundSource.md), `"choices"`\>

## Parameters

### selected

readonly `T`[]

## Returns

`T`[]
