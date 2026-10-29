[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / WeaponKeywordView

# Class: WeaponKeywordView

Defined in: [data/entities.ts:474](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L474)

A weapon-keyword catalog entry, linked to the weapons whose profiles
reference it. Exposes the keyword's mechanical effect as a buff stack
via [getBuffs](#getbuffs).

## Constructors

### Constructor

> **new WeaponKeywordView**(`raw`, `ds`): `WeaponKeywordView`

Defined in: [data/entities.ts:475](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L475)

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

Defined in: [data/entities.ts:477](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L477)

The full generated `WeaponKeyword` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:481](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L481)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:485](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L485)

##### Returns

`string`

***

### weapons

#### Get Signature

> **get** **weapons**(): [`WeaponView`](WeaponView.md)[]

Defined in: [data/entities.ts:490](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L490)

Weapons whose profiles reference this keyword id.

##### Returns

[`WeaponView`](WeaponView.md)[]

## Methods

### getBuffs()

> **getBuffs**(`parameters`, `weaponId`, `context`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/entities.ts:500](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L500)

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
