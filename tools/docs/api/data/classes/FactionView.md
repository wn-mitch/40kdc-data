[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / FactionView

# Class: FactionView

Defined in: [data/entities.ts:514](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L514)

A faction, linked to its units and the records scoped to it.

## Constructors

### Constructor

> **new FactionView**(`raw`, `ds`): `FactionView`

Defined in: [data/entities.ts:515](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L515)

#### Parameters

##### raw

[`Faction`](../../generated/interfaces/Faction.md)

The full generated `Faction` record.

##### ds

[`Dataset`](Dataset.md)

#### Returns

`FactionView`

## Properties

### raw

> `readonly` **raw**: [`Faction`](../../generated/interfaces/Faction.md)

Defined in: [data/entities.ts:517](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L517)

The full generated `Faction` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:521](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L521)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:525](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L525)

##### Returns

`string`

***

### logoUrl

#### Get Signature

> **get** **logoUrl**(): `string` \| `undefined`

Defined in: [data/entities.ts:530](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L530)

URL to the faction's logo/emblem image, or `undefined` if unset.

##### Returns

`string` \| `undefined`

***

### units

#### Get Signature

> **get** **units**(): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:535](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L535)

Units whose `faction_id` is this faction (may be empty for successors).

##### Returns

[`UnitView`](UnitView.md)[]

***

### abilities

#### Get Signature

> **get** **abilities**(): [`AbilityView`](AbilityView.md)[]

Defined in: [data/entities.ts:540](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L540)

Faction-scoped abilities (abilities whose `faction_id` is this faction).

##### Returns

[`AbilityView`](AbilityView.md)[]

***

### weapons

#### Get Signature

> **get** **weapons**(): [`WeaponView`](WeaponView.md)[]

Defined in: [data/entities.ts:545](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/entities.ts#L545)

Distinct weapons carried by this faction's units.

##### Returns

[`WeaponView`](WeaponView.md)[]
