[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AlliedKeywordLimit

# Interface: AlliedKeywordLimit

Defined in: [generated.ts:1122](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1122)

Per-keyword cap on how many units carrying `keyword` may be included via an allied rule at one battle size.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "allied-keyword-limit".

## Properties

### keyword

> **keyword**: `string`

Defined in: [generated.ts:1126](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1126)

Keyword the cap counts (matched case-insensitively against a unit's keywords union faction_keywords, e.g. 'Titanic', 'Armiger', 'Character').

***

### battle\_size

> **battle\_size**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [generated.ts:1130](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1130)

Battle size this cap applies at.

***

### max\_count

> **max\_count**: `number`

Defined in: [generated.ts:1134](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1134)

Maximum number of units carrying `keyword` includable via the rule at this battle size.
