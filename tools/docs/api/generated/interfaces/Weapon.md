[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Weapon

# Interface: Weapon

Defined in: [generated.ts:8281](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8281)

A weapon entry with one or more stat profiles (e.g., standard and overcharge modes).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "weapon".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:8282](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8282)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:8283](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8283)

***

### name

> **name**: `string`

Defined in: [generated.ts:8284](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8284)

***

### type

> **type**: `"ranged"` \| `"melee"`

Defined in: [generated.ts:8285](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8285)

***

### faction\_id?

> `optional` **faction\_id?**: `string`

Defined in: [generated.ts:8289](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8289)

Kebab-case identifier

***

### profiles

> **profiles**: \[\{ `name`: `string`; `range?`: `number` \| `"Melee"` \| `"N/A"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList13`](../type-aliases/KeywordList13.md); `excluded_keywords?`: [`KeywordList14`](../type-aliases/KeywordList14.md); \} \| `null`; \}, ...\{ name: string; range?: number \| "Melee" \| "N/A"; stats: \{ A: StatValue; BS?: number \| null; WS?: number \| null; S: StatValue; AP: number; D: StatValue; \[k: string\]: unknown \}; keywords?: WeaponKeywordRef\[\]; target\_restrictions?: \{ required\_keywords\_any?: KeywordList13; excluded\_keywords?: KeywordList14 \} \| null \}\[\]\]

Defined in: [generated.ts:8293](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8293)

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:8343](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8343)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes7`](../type-aliases/GameModes7.md)

Defined in: [generated.ts:8344](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8344)
