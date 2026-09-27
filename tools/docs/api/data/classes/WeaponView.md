[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / WeaponView

# Class: WeaponView

Defined in: [data/entities.ts:339](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L339)

A weapon, linked to the units that carry it.

## Constructors

### Constructor

> **new WeaponView**(`raw`, `ds`): `WeaponView`

Defined in: [data/entities.ts:340](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L340)

#### Parameters

##### raw

[`Weapon`](../../generated/interfaces/Weapon.md)

The full generated `Weapon` record.

##### ds

[`Dataset`](Dataset.md)

#### Returns

`WeaponView`

## Properties

### raw

> `readonly` **raw**: [`Weapon`](../../generated/interfaces/Weapon.md)

Defined in: [data/entities.ts:342](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L342)

The full generated `Weapon` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:346](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L346)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:350](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L350)

##### Returns

`string`

***

### type

#### Get Signature

> **get** **type**(): `string`

Defined in: [data/entities.ts:354](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L354)

##### Returns

`string`

***

### profiles

#### Get Signature

> **get** **profiles**(): readonly (\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \} \| \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \})[]

Defined in: [data/entities.ts:359](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L359)

All stat profiles for this weapon (at least one is always present).

##### Returns

readonly (\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \} \| \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \})[]

***

### profileCount

#### Get Signature

> **get** **profileCount**(): `number`

Defined in: [data/entities.ts:363](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L363)

##### Returns

`number`

***

### units

#### Get Signature

> **get** **units**(): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:368](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L368)

Units that list this weapon in their `weapon_ids`.

##### Returns

[`UnitView`](UnitView.md)[]

## Methods

### profileAt()

> **profileAt**(`i?`): \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \} \| \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \}

Defined in: [data/entities.ts:373](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L373)

The stat profile at index `i` (default 0).

#### Parameters

##### i?

`number` = `0`

#### Returns

##### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \}

###### name

> **name**: `string`

###### range?

> `optional` **range?**: `number` \| `"Melee"`

###### stats

> **stats**: `object`

###### Index Signature

\[`k`: `string`\]: `unknown`

###### stats.A

> **A**: [`StatValue`](../../generated/type-aliases/StatValue.md)

###### stats.BS?

> `optional` **BS?**: `number` \| `null`

###### stats.WS?

> `optional` **WS?**: `number` \| `null`

###### stats.S

> **S**: [`StatValue`](../../generated/type-aliases/StatValue.md)

###### stats.AP

> **AP**: `number`

###### stats.D

> **D**: [`StatValue`](../../generated/type-aliases/StatValue.md)

###### keywords?

> `optional` **keywords?**: `object`[]

References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values (e.g. `Sustained Hits 1` → `{keyword_id: 'sustained-hits', parameters: {value: 1}}`).

###### target\_restrictions?

> `optional` **target\_restrictions?**: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`

Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.

***

##### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`; \}

###### name

> **name**: `string`

###### range?

> `optional` **range?**: `number` \| `"Melee"`

###### stats

> **stats**: `object`

###### Index Signature

\[`k`: `string`\]: `unknown`

###### stats.A

> **A**: [`StatValue`](../../generated/type-aliases/StatValue.md)

###### stats.BS?

> `optional` **BS?**: `number` \| `null`

###### stats.WS?

> `optional` **WS?**: `number` \| `null`

###### stats.S

> **S**: [`StatValue`](../../generated/type-aliases/StatValue.md)

###### stats.AP

> **AP**: `number`

###### stats.D

> **D**: [`StatValue`](../../generated/type-aliases/StatValue.md)

###### keywords?

> `optional` **keywords?**: `object`[]

References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values (e.g. `Sustained Hits 1` → `{keyword_id: 'sustained-hits', parameters: {value: 1}}`).

###### target\_restrictions?

> `optional` **target\_restrictions?**: \{ `required_keywords_any?`: [`KeywordList10`](../../generated/type-aliases/KeywordList10.md); `excluded_keywords?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); \} \| `null`

Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.

***

### keywordsAt()

> **keywordsAt**(`i?`): `object`[]

Defined in: [data/entities.ts:387](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L387)

Catalog views for each keyword referenced by profile `i`, paired with the
reference-site parameters. Unresolved keyword ids are skipped.

#### Parameters

##### i?

`number` = `0`

#### Returns

`object`[]

***

### profileBuffs()

> **profileBuffs**(`i`, `context`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/entities.ts:409](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L409)

Buffs contributed by profile `i`'s intrinsic keywords against `context` —
the natural "what does this profile bring on its own?" call the engine
makes automatically before adding ability/manual buffs.

#### Parameters

##### i

`number` \| `undefined`

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

[`Buff`](../type-aliases/Buff.md)[]
