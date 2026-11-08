[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / mortalWoundSources

# Function: mortalWoundSources()

> **mortalWoundSources**(`abilityId`, `effect`, `trigger`, `context`, `rating?`): [`MortalWoundTranslation`](../type-aliases/MortalWoundTranslation.md)

Defined in: [cruncher/mortal-sources.ts:65](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/mortal-sources.ts#L65)

The mortal wounds `effect` (with the record's own `trigger`) inflicts on an enemy unit outside an
attack. A condition the context leaves undecided is reported as a need and assumed to hold; one
it decides false removes what it gates. `phase-is` conditions never gate a source: the moment
names when it happens, whatever phase the attack is made in. Mortal wounds the ability's own
unit suffers are not sources.

## Parameters

### abilityId

`string`

### effect

`unknown`

### trigger

`unknown`

### context

[`EngineContext`](../type-aliases/EngineContext.md)

### rating?

`string` \| `number`

## Returns

[`MortalWoundTranslation`](../type-aliases/MortalWoundTranslation.md)
