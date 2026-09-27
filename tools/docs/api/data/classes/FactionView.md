[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / FactionView

# Class: FactionView

Defined in: [data/entities.ts:474](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L474)

A faction, linked to its units and the records scoped to it.

## Constructors

### Constructor

> **new FactionView**(`raw`, `ds`): `FactionView`

Defined in: [data/entities.ts:475](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L475)

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

Defined in: [data/entities.ts:477](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L477)

The full generated `Faction` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:481](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L481)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:485](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L485)

##### Returns

`string`

***

### logoUrl

#### Get Signature

> **get** **logoUrl**(): `string` \| `undefined`

Defined in: [data/entities.ts:490](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L490)

URL to the faction's logo/emblem image, or `undefined` if unset.

##### Returns

`string` \| `undefined`

***

### units

#### Get Signature

> **get** **units**(): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:495](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L495)

Units whose `faction_id` is this faction (may be empty for successors).

##### Returns

[`UnitView`](UnitView.md)[]

***

### abilities

#### Get Signature

> **get** **abilities**(): [`AbilityView`](AbilityView.md)[]

Defined in: [data/entities.ts:500](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L500)

Faction-scoped abilities (abilities whose `faction_id` is this faction).

##### Returns

[`AbilityView`](AbilityView.md)[]

***

### weapons

#### Get Signature

> **get** **weapons**(): [`WeaponView`](WeaponView.md)[]

Defined in: [data/entities.ts:505](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L505)

Distinct weapons carried by this faction's units.

##### Returns

[`WeaponView`](WeaponView.md)[]
