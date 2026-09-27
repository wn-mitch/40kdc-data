[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WeaponKeyword

# Interface: WeaponKeyword

Defined in: [generated.ts:4280](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4280)

Catalog entry for a weapon keyword (Lethal Hits, Sustained Hits N, Anti-X N+, etc.). Each weapon profile references entries here via {keyword_id, parameters?} instead of carrying free-text strings. The optional `effect` describes the keyword's game mechanic in the Ability DSL; null when the behaviour is faction-specific flavour not yet modelled.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "weapon-keyword".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:4281](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4281)

***

### name

> **name**: `string`

Defined in: [generated.ts:4282](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4282)

***

### required\_parameters

> **required\_parameters**: \[\] \| \[`"threshold"` \| `"value"` \| `"target_keyword"`\] \| \[`"threshold"` \| `"value"` \| `"target_keyword"`, `"threshold"` \| `"value"` \| `"target_keyword"`\] \| \[`"threshold"` \| `"value"` \| `"target_keyword"`, `"threshold"` \| `"value"` \| `"target_keyword"`, `"threshold"` \| `"value"` \| `"target_keyword"`\]

Defined in: [generated.ts:4288](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4288)

Parameter keys that must be supplied at each reference site, in the order they would appear in a printed datasheet (e.g. Anti-INFANTRY 4+ → ['target_keyword', 'threshold']).

#### Max Items

3

***

### effect

> **effect**: [`AbilityEffect1`](../type-aliases/AbilityEffect1.md) \| `null`

Defined in: [generated.ts:4300](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4300)

Mechanical effect of this keyword. Null when the behaviour is faction-specific flavour not yet expressible in the DSL — engines treat such references as no-op buffs and may surface them as 'cannot auto-apply'.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:4301](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4301)
