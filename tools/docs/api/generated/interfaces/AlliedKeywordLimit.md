[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AlliedKeywordLimit

# Interface: AlliedKeywordLimit

Defined in: [generated.ts:2428](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2428)

Per-keyword cap on how many units carrying `keyword` may be included via an allied rule at one battle size.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "allied-keyword-limit".

## Properties

### keyword

> **keyword**: `string`

Defined in: [generated.ts:2432](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2432)

Keyword the cap counts (matched case-insensitively against a unit's keywords union faction_keywords, e.g. 'Titanic', 'Armiger', 'Character').

***

### battle\_size

> **battle\_size**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [generated.ts:2436](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2436)

Battle size this cap applies at.

***

### max\_count

> **max\_count**: `number`

Defined in: [generated.ts:2440](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2440)

Maximum number of units carrying `keyword` includable via the rule at this battle size.
