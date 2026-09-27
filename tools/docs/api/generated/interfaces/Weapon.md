[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Weapon

# Interface: Weapon

Defined in: [generated.ts:4309](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4309)

A weapon entry with one or more stat profiles (e.g., standard and overcharge modes).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "weapon".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:4310](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4310)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:4311](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4311)

***

### name

> **name**: `string`

Defined in: [generated.ts:4312](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4312)

***

### type

> **type**: `"ranged"` \| `"melee"`

Defined in: [generated.ts:4313](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4313)

***

### faction\_id?

> `optional` **faction\_id?**: `string`

Defined in: [generated.ts:4317](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4317)

Kebab-case identifier

***

### profiles

> **profiles**: \[\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../type-aliases/KeywordList11.md); \} \| `null`; \}, ...\{ name: string; range?: number \| "Melee"; stats: \{ A: StatValue; BS?: number \| null; WS?: number \| null; S: StatValue; AP: number; D: StatValue; \[k: string\]: unknown \}; keywords?: \{ keyword\_id: string; parameters?: \{ value?: StatValue; target\_keyword?: string; threshold?: number; required\_target\_keywords\_any?: KeywordList8; excluded\_target\_keywords?: KeywordList9 \} \}\[\]; target\_restrictions?: \{ required\_keywords\_any?: KeywordList10; excluded\_keywords?: KeywordList11 \} \| null \}\[\]\]

Defined in: [generated.ts:4321](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4321)

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:4395](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4395)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes7`](../type-aliases/GameModes7.md)

Defined in: [generated.ts:4396](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4396)
