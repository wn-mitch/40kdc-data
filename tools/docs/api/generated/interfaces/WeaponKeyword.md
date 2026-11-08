[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WeaponKeyword

# Interface: WeaponKeyword

Defined in: [generated.ts:8238](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8238)

Catalog entry for a weapon keyword (Lethal Hits, Sustained Hits N, Anti-X N+, etc.). Each weapon profile references entries here via {keyword_id, parameters?} instead of carrying free-text strings. The optional `effect` describes the keyword's game mechanic in the Ability DSL; null when the behaviour is faction-specific flavour not yet modelled.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "weapon-keyword".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:8239](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8239)

***

### name

> **name**: `string`

Defined in: [generated.ts:8240](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8240)

***

### required\_parameters

> **required\_parameters**: \[\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`\]

Defined in: [generated.ts:8246](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8246)

Parameter keys that must be supplied at each reference site, in the order they would appear in a printed datasheet (e.g. Anti-INFANTRY 4+ → ['target_keyword', 'threshold']).

#### Max Items

3

***

### optional\_parameters?

> `optional` **optional\_parameters?**: \[\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`\]

Defined in: [generated.ts:8260](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8260)

Additional parameter keys accepted when the granting rule supplies them. Omission never invents a rating.

#### Max Items

3

***

### effect

> **effect**: [`AbilityEffect1`](../type-aliases/AbilityEffect1.md) \| `null`

Defined in: [generated.ts:8272](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8272)

Mechanical effect of this keyword. Null when the behaviour is faction-specific flavour not yet expressible in the DSL — engines treat such references as no-op buffs and may surface them as 'cannot auto-apply'.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:8273](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8273)
