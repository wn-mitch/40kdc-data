[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / buffsFromKeyword

# Function: buffsFromKeyword()

> **buffsFromKeyword**(`args`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [cruncher/from-keyword.ts:59](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/from-keyword.ts#L59)

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
