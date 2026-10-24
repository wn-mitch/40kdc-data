[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WeaponKeyword

# Interface: WeaponKeyword

Defined in: [generated.ts:7009](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7009)

Catalog entry for a weapon keyword (Lethal Hits, Sustained Hits N, Anti-X N+, etc.). Each weapon profile references entries here via {keyword_id, parameters?} instead of carrying free-text strings. The optional `effect` describes the keyword's game mechanic in the Ability DSL; null when the behaviour is faction-specific flavour not yet modelled.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "weapon-keyword".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:7010](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7010)

***

### name

> **name**: `string`

Defined in: [generated.ts:7011](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7011)

***

### required\_parameters

> **required\_parameters**: \[\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`\]

Defined in: [generated.ts:7017](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7017)

Parameter keys that must be supplied at each reference site, in the order they would appear in a printed datasheet (e.g. Anti-INFANTRY 4+ → ['target_keyword', 'threshold']).

#### Max Items

3

***

### optional\_parameters?

> `optional` **optional\_parameters?**: \[\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`\] \| \[`"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`, `"value"` \| `"threshold"` \| `"target_keyword"`\]

Defined in: [generated.ts:7031](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7031)

Additional parameter keys accepted when the granting rule supplies them. Omission never invents a rating.

#### Max Items

3

***

### effect

> **effect**: [`AbilityEffect1`](../type-aliases/AbilityEffect1.md) \| `null`

Defined in: [generated.ts:7043](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7043)

Mechanical effect of this keyword. Null when the behaviour is faction-specific flavour not yet expressible in the DSL — engines treat such references as no-op buffs and may surface them as 'cannot auto-apply'.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:7044](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7044)
