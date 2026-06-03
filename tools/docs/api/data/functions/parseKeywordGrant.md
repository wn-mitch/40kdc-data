[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / parseKeywordGrant

# Function: parseKeywordGrant()

> **parseKeywordGrant**(`raw`): [`WeaponKeywordRef`](../type-aliases/WeaponKeywordRef.md) \| `null`

Defined in: [cruncher/from-dsl.ts:1220](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/from-dsl.ts#L1220)

Parse a printed weapon-keyword string (e.g. `"Sustained Hits 1"`,
`"Anti-INFANTRY 4+"`, `"Lethal Hits"`) into a `{keyword_id, parameters?}`
catalog reference, or `null` if the form is unrecognised.

Reverses the conventions baked into the M0 catalog: kebab-case ids,
trailing number → `value`, embedded keyword + threshold → `target_keyword`
+ `threshold`.

## Parameters

### raw

`string`

## Returns

[`WeaponKeywordRef`](../type-aliases/WeaponKeywordRef.md) \| `null`
