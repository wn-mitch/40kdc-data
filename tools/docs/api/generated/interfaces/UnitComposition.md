[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitComposition

# Interface: UnitComposition

Defined in: [generated.ts:3752](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3752)

Describes the internal model-type breakdown of a unit.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit-composition".

## Properties

### unit\_id

> **unit\_id**: `string`

Defined in: [generated.ts:3753](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3753)

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:3757](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3757)

Kebab-case identifier

***

### models

> **models**: \[\{ `name`: `string`; `profile_name?`: `string` \| `null`; `min`: `number`; `max`: `number`; `default_weapon_ids?`: `string`[]; `is_leader_model?`: `boolean`; `base_size_mm?`: [`BaseSize1`](BaseSize1.md); `hull_shape_id?`: `string` \| `null`; `loadout_variants?`: \[\{ `name`: `string`; `weapon_ids`: \[`string`, `...string[]`\]; `max_count?`: `number`; \}, `...{ name: string; weapon_ids: [string, ...string[]]; max_count?: number }[]`\]; `loadout_variant_budgets?`: \[\{ `variant_names`: \[`string`, `...string[]`\]; `count`: `number`; `per_models`: `number`; `scope`: `"unit"` \| `"model-row"`; \}, ...\{ variant\_names: \[string, ...string\[\]\]; count: number; per\_models: number; scope: "unit" \| "model-row" \}\[\]\]; \}, ...\{ name: string; profile\_name?: string \| null; min: number; max: number; default\_weapon\_ids?: string\[\]; is\_leader\_model?: boolean; base\_size\_mm?: BaseSize1; hull\_shape\_id?: string \| null; loadout\_variants?: \[\{ name: string; weapon\_ids: \[string, ...string\[\]\]; max\_count?: number \}, ...\{ name: string; weapon\_ids: \[string, ...string\[\]\]; max\_count?: number \}\[\]\]; loadout\_variant\_budgets?: \[\{ variant\_names: \[string, ...string\[\]\]; count: number; per\_models: number; scope: "unit" \| "model-row" \}, ...\{ variant\_names: \[string, ...string\[\]\]; count: number; per\_models: number; scope: "unit" \| "model-row" \}\[\]\] \}\[\]\]

Defined in: [generated.ts:3761](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3761)

#### Min Items

1

***

### tiers?

> `optional` **tiers?**: \[\{ `models`: \[\{ `name`: `string`; `min`: `number`; `max`: `number`; \}, `...{ name: string; min: number; max: number }[]`\]; \}, `...{ models: [{ name: string; min: number; max: number }, ...{ name: string; min: number; max: number }[]] }[]`\]

Defined in: [generated.ts:3960](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3960)

The discrete buildable squad sizes (GW's per-datasheet unit-composition rows). Each tier gives a per-model count range; a legal squad must match exactly one tier. When absent, the squad is treated as a single implicit tier equal to `models[]`. The top-level `models[]` min/max are the aggregate envelope (min-of-mins / max-of-maxes) across the tiers, so consumers that read only `models[]` still see the full range.

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:4000](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4000)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes4`](../type-aliases/GameModes4.md)

Defined in: [generated.ts:4001](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4001)
