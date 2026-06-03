[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Weapon

# Interface: Weapon

Defined in: [generated.ts:1329](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1329)

A weapon entry with one or more stat profiles (e.g., standard and overcharge modes).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "weapon".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:1330](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1330)

***

### name

> **name**: `string`

Defined in: [generated.ts:1331](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1331)

***

### type

> **type**: `"ranged"` \| `"melee"`

Defined in: [generated.ts:1332](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1332)

***

### profiles

> **profiles**: \[\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../type-aliases/StatValue.md); \}; `keywords?`: `object`[]; \}, ...\{ name: string; range?: number \| "Melee"; stats: \{ A: StatValue; BS?: number \| null; WS?: number \| null; S: StatValue; AP: number; D: StatValue; \[k: string\]: unknown \}; keywords?: \{ keyword\_id: string; parameters?: \{ value?: StatValue; target\_keyword?: string; threshold?: number \} \}\[\] \}\[\]\]

Defined in: [generated.ts:1336](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1336)

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1392](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1392)
