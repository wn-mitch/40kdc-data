[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / buffsFromKeyword

# Function: buffsFromKeyword()

> **buffsFromKeyword**(`args`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [cruncher/from-keyword.ts:41](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/from-keyword.ts#L41)

Convert a single weapon-keyword reference (catalog effect + reference-site
parameters) into the buff contributions it makes against `context`.

## Parameters

### args

#### keywordId

`string`

#### weaponId

`string`

#### effect

`unknown`

#### parameters?

`Record`\<`string`, `unknown`\>

#### context

[`EngineContext`](../type-aliases/EngineContext.md)

## Returns

[`Buff`](../type-aliases/Buff.md)[]
