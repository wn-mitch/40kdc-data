[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AlliedKeywordLimit

# Interface: AlliedKeywordLimit

Defined in: [generated.ts:2873](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2873)

Per-keyword cap on how many units carrying `keyword` may be included via an allied rule at one battle size.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "allied-keyword-limit".

## Properties

### keyword

> **keyword**: `string`

Defined in: [generated.ts:2877](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2877)

Keyword the cap counts (matched case-insensitively against a unit's keywords union faction_keywords, e.g. 'Titanic', 'Armiger', 'Character').

***

### battle\_size

> **battle\_size**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [generated.ts:2881](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2881)

Battle size this cap applies at.

***

### max\_count

> **max\_count**: `number`

Defined in: [generated.ts:2885](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2885)

Maximum number of units carrying `keyword` includable via the rule at this battle size.
