[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitComposition

# Interface: UnitComposition

Defined in: [generated.ts:7129](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7129)

Describes the internal model-type breakdown of a unit.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit-composition".

## Properties

### unit\_id

> **unit\_id**: `string`

Defined in: [generated.ts:7130](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7130)

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:7134](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7134)

Kebab-case identifier

***

### models

> **models**: \[\{ `name`: `string`; `profile_name?`: `string` \| `null`; `min`: `number`; `max`: `number`; `default_weapon_ids?`: `string`[]; `is_leader_model?`: `boolean`; `excluded_from_enhancements?`: `boolean`; `base_size_mm?`: [`BaseSize1`](BaseSize1.md); `hull_shape_id?`: `string` \| `null`; `loadout_variants?`: \[\{ `name`: `string`; `weapon_ids`: \[`string`, `...string[]`\]; `max_count?`: `number`; \}, `...{ name: string; weapon_ids: [string, ...string[]]; max_count?: number }[]`\]; `loadout_variant_budgets?`: \[\{ `variant_names`: \[`string`, `...string[]`\]; `count`: `number`; `per_models`: `number`; `scope`: `"unit"` \| `"model-row"`; `stepped?`: `boolean`; \}, ...\{ variant\_names: \[string, ...string\[\]\]; count: number; per\_models: number; scope: "unit" \| "model-row"; stepped?: boolean \}\[\]\]; \}, ...\{ name: string; profile\_name?: string \| null; min: number; max: number; default\_weapon\_ids?: string\[\]; is\_leader\_model?: boolean; excluded\_from\_enhancements?: boolean; base\_size\_mm?: BaseSize1; hull\_shape\_id?: string \| null; loadout\_variants?: \[\{ name: string; weapon\_ids: \[string, ...string\[\]\]; max\_count?: number \}, ...\{ name: string; weapon\_ids: \[string, ...string\[\]\]; max\_count?: number \}\[\]\]; loadout\_variant\_budgets?: \[\{ variant\_names: \[string, ...string\[\]\]; count: number; per\_models: number; scope: "unit" \| "model-row"; stepped?: boolean \}, ...\{ variant\_names: \[string, ...string\[\]\]; count: number; per\_models: number; scope: "unit" \| "model-row"; stepped?: boolean \}\[\]\] \}\[\]\]

Defined in: [generated.ts:7138](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7138)

#### Min Items

1

***

### tiers?

> `optional` **tiers?**: \[\{ `models`: \[\{ `name`: `string`; `min`: `number`; `max`: `number`; \}, `...{ name: string; min: number; max: number }[]`\]; \}, `...{ models: [{ name: string; min: number; max: number }, ...{ name: string; min: number; max: number }[]] }[]`\]

Defined in: [generated.ts:7361](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7361)

The discrete buildable squad sizes (GW's per-datasheet unit-composition rows). Each tier gives a per-model count range; a legal squad must match exactly one tier. When absent, the squad is treated as a single implicit tier equal to `models[]`. The top-level `models[]` min/max are the aggregate envelope (min-of-mins / max-of-maxes) across the tiers, so consumers that read only `models[]` still see the full range.

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:7401](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7401)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes4`](../type-aliases/GameModes4.md)

Defined in: [generated.ts:7402](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7402)
