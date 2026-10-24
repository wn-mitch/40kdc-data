[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / WeaponView

# Class: WeaponView

Defined in: [data/entities.ts:379](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L379)

A weapon, linked to the units that carry it.

## Constructors

### Constructor

> **new WeaponView**(`raw`, `ds`): `WeaponView`

Defined in: [data/entities.ts:380](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L380)

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

Defined in: [data/entities.ts:382](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L382)

The full generated `Weapon` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:386](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L386)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:390](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L390)

##### Returns

`string`

***

### type

#### Get Signature

> **get** **type**(): `string`

Defined in: [data/entities.ts:394](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L394)

##### Returns

`string`

***

### profiles

#### Get Signature

> **get** **profiles**(): readonly (\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \} \| \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \})[]

Defined in: [data/entities.ts:399](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L399)

All stat profiles for this weapon (at least one is always present).

##### Returns

readonly (\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \} \| \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \})[]

***

### profileCount

#### Get Signature

> **get** **profileCount**(): `number`

Defined in: [data/entities.ts:403](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L403)

##### Returns

`number`

***

### units

#### Get Signature

> **get** **units**(): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:408](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L408)

Units that list this weapon in their `weapon_ids`.

##### Returns

[`UnitView`](UnitView.md)[]

## Methods

### profileAt()

> **profileAt**(`i?`): \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \} \| \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \}

Defined in: [data/entities.ts:413](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L413)

The stat profile at index `i` (default 0).

#### Parameters

##### i?

`number` = `0`

#### Returns

##### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \}

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

> `optional` **keywords?**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values.

###### target\_restrictions?

> `optional` **target\_restrictions?**: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`

Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.

***

##### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]; `target_restrictions?`: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`; \}

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

> `optional` **keywords?**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values.

###### target\_restrictions?

> `optional` **target\_restrictions?**: \{ `required_keywords_any?`: [`KeywordList11`](../../generated/type-aliases/KeywordList11.md); `excluded_keywords?`: [`KeywordList12`](../../generated/type-aliases/KeywordList12.md); \} \| `null`

Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.

***

### keywordsAt()

> **keywordsAt**(`i?`): `object`[]

Defined in: [data/entities.ts:427](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L427)

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

Defined in: [data/entities.ts:449](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L449)

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
