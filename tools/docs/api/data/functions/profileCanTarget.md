[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / profileCanTarget

# Function: profileCanTarget()

> **profileCanTarget**(`profile`, `target`): `boolean`

Defined in: [cruncher/engine.ts:51](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/engine.ts#L51)

Whether a weapon profile may select this target under profile-level restrictions such as Hunter.

## Parameters

### profile

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \} \| \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \}

#### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \}

##### name

`string`

##### range?

`number` \| `"Melee"`

##### stats

\{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}

##### stats.A

[`StatValue`](../../generated/type-aliases/StatValue.md)

##### stats.BS?

`number` \| `null`

##### stats.WS?

`number` \| `null`

##### stats.S

[`StatValue`](../../generated/type-aliases/StatValue.md)

##### stats.AP

`number`

##### stats.D

[`StatValue`](../../generated/type-aliases/StatValue.md)

##### keywords?

[`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values.

##### target_restrictions?

\{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`

Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.

***

#### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \}

##### name

`string`

##### range?

`number` \| `"Melee"`

##### stats

\{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}

##### stats.A

[`StatValue`](../../generated/type-aliases/StatValue.md)

##### stats.BS?

`number` \| `null`

##### stats.WS?

`number` \| `null`

##### stats.S

[`StatValue`](../../generated/type-aliases/StatValue.md)

##### stats.AP

`number`

##### stats.D

[`StatValue`](../../generated/type-aliases/StatValue.md)

##### keywords?

[`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values.

##### target_restrictions?

\{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`

Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.

### target

[`Unit`](../../generated/interfaces/Unit.md)

## Returns

`boolean`
