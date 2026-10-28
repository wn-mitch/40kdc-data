[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AlliedKeywordLimit

# Interface: AlliedKeywordLimit

Defined in: [generated.ts:2752](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2752)

Per-keyword cap on how many units carrying `keyword` may be included via an allied rule at one battle size.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "allied-keyword-limit".

## Properties

### keyword

> **keyword**: `string`

Defined in: [generated.ts:2756](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2756)

Keyword the cap counts (matched case-insensitively against a unit's keywords union faction_keywords, e.g. 'Titanic', 'Armiger', 'Character').

***

### battle\_size

> **battle\_size**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [generated.ts:2760](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2760)

Battle size this cap applies at.

***

### max\_count

> **max\_count**: `number`

Defined in: [generated.ts:2764](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2764)

Maximum number of units carrying `keyword` includable via the rule at this battle size.
