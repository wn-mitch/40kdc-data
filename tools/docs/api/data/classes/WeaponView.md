[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / WeaponView

# Class: WeaponView

Defined in: [data/entities.ts:146](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L146)

A weapon, linked to the units that carry it.

## Constructors

### Constructor

> **new WeaponView**(`raw`, `ds`): `WeaponView`

Defined in: [data/entities.ts:147](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L147)

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

Defined in: [data/entities.ts:149](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L149)

The full generated `Weapon` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:153](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L153)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:157](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L157)

##### Returns

`string`

***

### units

#### Get Signature

> **get** **units**(): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:162](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L162)

Units that list this weapon in their `weapon_ids`.

##### Returns

[`UnitView`](UnitView.md)[]

## Methods

### profileAt()

> **profileAt**(`i?`): \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; \} \| \{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; \}

Defined in: [data/entities.ts:167](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L167)

The stat profile at index `i` (default 0).

#### Parameters

##### i?

`number` = `0`

#### Returns

##### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; \}

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

***

##### Type Literal

\{ `name`: `string`; `range?`: `number` \| `"Melee"`; `stats`: \{\[`k`: `string`\]: `unknown`; `A`: [`StatValue`](../../generated/type-aliases/StatValue.md); `BS?`: `number` \| `null`; `WS?`: `number` \| `null`; `S`: [`StatValue`](../../generated/type-aliases/StatValue.md); `AP`: `number`; `D`: [`StatValue`](../../generated/type-aliases/StatValue.md); \}; `keywords?`: `object`[]; \}

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

***

### keywordsAt()

> **keywordsAt**(`i?`): `object`[]

Defined in: [data/entities.ts:181](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L181)

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

Defined in: [data/entities.ts:203](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L203)

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
