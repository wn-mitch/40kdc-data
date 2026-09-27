[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / buffsFromKeyword

# Function: buffsFromKeyword()

> **buffsFromKeyword**(`args`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [cruncher/from-keyword.ts:57](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-keyword.ts#L57)

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
