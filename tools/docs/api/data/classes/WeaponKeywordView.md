[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / WeaponKeywordView

# Class: WeaponKeywordView

Defined in: [data/entities.ts:226](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L226)

A weapon-keyword catalog entry, linked to the weapons whose profiles
reference it. Exposes the keyword's mechanical effect as a buff stack
via [getBuffs](#getbuffs).

## Constructors

### Constructor

> **new WeaponKeywordView**(`raw`, `ds`): `WeaponKeywordView`

Defined in: [data/entities.ts:227](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L227)

#### Parameters

##### raw

[`WeaponKeyword`](../../generated/interfaces/WeaponKeyword.md)

The full generated `WeaponKeyword` record.

##### ds

[`Dataset`](Dataset.md)

#### Returns

`WeaponKeywordView`

## Properties

### raw

> `readonly` **raw**: [`WeaponKeyword`](../../generated/interfaces/WeaponKeyword.md)

Defined in: [data/entities.ts:229](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L229)

The full generated `WeaponKeyword` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:233](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L233)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:237](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L237)

##### Returns

`string`

***

### weapons

#### Get Signature

> **get** **weapons**(): [`WeaponView`](WeaponView.md)[]

Defined in: [data/entities.ts:242](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L242)

Weapons whose profiles reference this keyword id.

##### Returns

[`WeaponView`](WeaponView.md)[]

## Methods

### getBuffs()

> **getBuffs**(`parameters`, `weaponId`, `context`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/entities.ts:252](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L252)

Buff contributions from this catalog entry, for one reference site:
pass the keyword's `parameters` (e.g. `{ value: 1 }` for Sustained Hits 1)
along with the `weaponId` that's carrying it (used as the buff source)
and the engine `context` (e.g. attacker stationary?).

#### Parameters

##### parameters

`Record`\<`string`, `unknown`\> \| `undefined`

##### weaponId

`string`

##### context

[`EngineContext`](../type-aliases/EngineContext.md)

#### Returns

[`Buff`](../type-aliases/Buff.md)[]
