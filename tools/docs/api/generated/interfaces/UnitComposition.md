[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitComposition

# Interface: UnitComposition

Defined in: [generated.ts:1117](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1117)

Describes the internal model-type breakdown of a unit.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit-composition".

## Properties

### unit\_id

> **unit\_id**: `string`

Defined in: [generated.ts:1118](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1118)

***

### models

> **models**: \[\{ `name`: `string`; `profile_name?`: `string` \| `null`; `min`: `number`; `max`: `number`; `default_weapon_ids?`: `string`[]; `is_leader_model?`: `boolean`; `base_size_mm?`: [`BaseSize1`](BaseSize1.md); \}, ...\{ name: string; profile\_name?: string \| null; min: number; max: number; default\_weapon\_ids?: string\[\]; is\_leader\_model?: boolean; base\_size\_mm?: BaseSize1 \}\[\]\]

Defined in: [generated.ts:1122](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1122)

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1142](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1142)
