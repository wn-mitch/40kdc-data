[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / parseKeywordGrant

# Function: parseKeywordGrant()

> **parseKeywordGrant**(`raw`): [`WeaponKeywordRef`](../type-aliases/WeaponKeywordRef.md) \| `null`

Defined in: [cruncher/from-dsl.ts:1612](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L1612)

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
