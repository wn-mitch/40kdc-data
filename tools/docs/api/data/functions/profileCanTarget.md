[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / profileCanTarget

# Function: profileCanTarget()

> **profileCanTarget**(`profile`, `target`): `boolean`

Defined in: [cruncher/engine.ts:50](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/engine.ts#L50)

Whether a weapon profile may select this target under profile-level restrictions such as Hunter.

## Parameters

### profile

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \} \| \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \}

#### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \}

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

`object`[]

References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values (e.g. `Sustained Hits 1` → `{keyword_id: 'sustained-hits', parameters: {value: 1}}`).

##### target_restrictions?

\{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`

Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.

***

#### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \}

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

`object`[]

References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values (e.g. `Sustained Hits 1` → `{keyword_id: 'sustained-hits', parameters: {value: 1}}`).

##### target_restrictions?

\{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`

Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.

### target

[`Unit`](../../generated/interfaces/Unit.md)

## Returns

`boolean`
