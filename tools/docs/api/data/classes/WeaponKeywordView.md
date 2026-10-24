[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / WeaponKeywordView

# Class: WeaponKeywordView

Defined in: [data/entities.ts:472](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L472)

A weapon-keyword catalog entry, linked to the weapons whose profiles
reference it. Exposes the keyword's mechanical effect as a buff stack
via [getBuffs](#getbuffs).

## Constructors

### Constructor

> **new WeaponKeywordView**(`raw`, `ds`): `WeaponKeywordView`

Defined in: [data/entities.ts:473](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L473)

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

Defined in: [data/entities.ts:475](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L475)

The full generated `WeaponKeyword` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:479](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L479)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:483](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L483)

##### Returns

`string`

***

### weapons

#### Get Signature

> **get** **weapons**(): [`WeaponView`](WeaponView.md)[]

Defined in: [data/entities.ts:488](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L488)

Weapons whose profiles reference this keyword id.

##### Returns

[`WeaponView`](WeaponView.md)[]

## Methods

### getBuffs()

> **getBuffs**(`parameters`, `weaponId`, `context`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/entities.ts:498](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L498)

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
