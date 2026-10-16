[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitKeyword

# Interface: UnitKeyword

Defined in: [generated.ts:6738](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6738)

Catalog entry for a universal unit ability (a 'Core ability' in the rulebook: Deep Strike, Scouts X", Feel No Pain X+, Deadly Demise X, etc.). These are the unit-side counterpart of weapon-keyword.schema.json — community-authored mechanic labels, not reproduced rules text. A unit references a parameterised instance from its `ability_ids` (e.g. `scouts-6`); this catalog records the value-agnostic definition keyed by base id (e.g. `scouts`). The optional `effect` describes the mechanic in the Ability DSL; null when the behaviour is modelled per-faction in enrichment data rather than here.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit-keyword".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:6739](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6739)

***

### name

> **name**: `string`

Defined in: [generated.ts:6740](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6740)

***

### required\_parameters

> **required\_parameters**: \[\] \| \[`"value"`\]

Defined in: [generated.ts:6746](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6746)

Parameter keys that must be supplied at each reference site (e.g. Scouts 6" → ['value']). Empty for abilities that take no number (Deep Strike, Infiltrators, Stealth).

#### Max Items

1

***

### effect

> **effect**: [`AbilityEffect1`](../type-aliases/AbilityEffect1.md) \| `null`

Defined in: [generated.ts:6750](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6750)

Mechanical effect of this ability. Null when the behaviour is authored per-faction in the enrichment Ability DSL rather than centrally here — engines resolve the per-faction record.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:6751](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6751)
