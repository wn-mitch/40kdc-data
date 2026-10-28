[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / FactionView

# Class: FactionView

Defined in: [data/entities.ts:516](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L516)

A faction, linked to its units and the records scoped to it.

## Constructors

### Constructor

> **new FactionView**(`raw`, `ds`): `FactionView`

Defined in: [data/entities.ts:517](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L517)

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

Defined in: [data/entities.ts:519](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L519)

The full generated `Faction` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:523](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L523)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:527](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L527)

##### Returns

`string`

***

### logoUrl

#### Get Signature

> **get** **logoUrl**(): `string` \| `undefined`

Defined in: [data/entities.ts:532](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L532)

URL to the faction's logo/emblem image, or `undefined` if unset.

##### Returns

`string` \| `undefined`

***

### units

#### Get Signature

> **get** **units**(): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:537](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L537)

Units whose `faction_id` is this faction (may be empty for successors).

##### Returns

[`UnitView`](UnitView.md)[]

***

### abilities

#### Get Signature

> **get** **abilities**(): [`AbilityView`](AbilityView.md)[]

Defined in: [data/entities.ts:542](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L542)

Faction-scoped abilities (abilities whose `faction_id` is this faction).

##### Returns

[`AbilityView`](AbilityView.md)[]

***

### weapons

#### Get Signature

> **get** **weapons**(): [`WeaponView`](WeaponView.md)[]

Defined in: [data/entities.ts:547](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L547)

Distinct weapons carried by this faction's units.

##### Returns

[`WeaponView`](WeaponView.md)[]
