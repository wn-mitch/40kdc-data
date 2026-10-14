[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitKeyword

# Interface: UnitKeyword

Defined in: [generated.ts:4026](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4026)

Catalog entry for a universal unit ability (a 'Core ability' in the rulebook: Deep Strike, Scouts X", Feel No Pain X+, Deadly Demise X, etc.). These are the unit-side counterpart of weapon-keyword.schema.json — community-authored mechanic labels, not reproduced rules text. A unit references a parameterised instance from its `ability_ids` (e.g. `scouts-6`); this catalog records the value-agnostic definition keyed by base id (e.g. `scouts`). The optional `effect` describes the mechanic in the Ability DSL; null when the behaviour is modelled per-faction in enrichment data rather than here.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit-keyword".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:4027](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4027)

***

### name

> **name**: `string`

Defined in: [generated.ts:4028](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4028)

***

### required\_parameters

> **required\_parameters**: \[\] \| \[`"value"`\]

Defined in: [generated.ts:4034](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4034)

Parameter keys that must be supplied at each reference site (e.g. Scouts 6" → ['value']). Empty for abilities that take no number (Deep Strike, Infiltrators, Stealth).

#### Max Items

1

***

### effect

> **effect**: [`AbilityEffect1`](../type-aliases/AbilityEffect1.md) \| `null`

Defined in: [generated.ts:4038](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4038)

Mechanical effect of this ability. Null when the behaviour is authored per-faction in the enrichment Ability DSL rather than centrally here — engines resolve the per-faction record.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:4039](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4039)
