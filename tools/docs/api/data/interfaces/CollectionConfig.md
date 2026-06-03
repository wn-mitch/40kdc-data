[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / CollectionConfig

# Interface: CollectionConfig\<T, V\>

Defined in: [data/collection.ts:19](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/collection.ts#L19)

How a [Collection](../classes/Collection.md) reads keys and builds views from raw records.

## Type Parameters

### T

`T`

### V

`V`

## Properties

### items

> **items**: `T`[]

Defined in: [data/collection.ts:20](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/collection.ts#L20)

***

### idOf

> **idOf**: (`item`) => `string`

Defined in: [data/collection.ts:22](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/collection.ts#L22)

Primary id of a record (e.g. `u => u.id`, `a => a.ability_id`).

#### Parameters

##### item

`T`

#### Returns

`string`

***

### dedupeKeyOf?

> `optional` **dedupeKeyOf?**: (`item`) => `string`

Defined in: [data/collection.ts:28](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/collection.ts#L28)

Uniqueness key used for deduplication. Defaults to [idOf](#idof). Set to a
composite (e.g. `(faction_id, id)`) for records that share an id across
factions, so distinct copies are preserved rather than collapsed.

#### Parameters

##### item

`T`

#### Returns

`string`

***

### nameOf?

> `optional` **nameOf?**: (`item`) => `string` \| `undefined`

Defined in: [data/collection.ts:30](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/collection.ts#L30)

Display name, if the record has one — drives [Collection.find](../classes/Collection.md#find).

#### Parameters

##### item

`T`

#### Returns

`string` \| `undefined`

***

### factionOf?

> `optional` **factionOf?**: (`item`) => `string` \| `null` \| `undefined`

Defined in: [data/collection.ts:32](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/collection.ts#L32)

Owning faction id, if applicable — drives [Collection.byFaction](../classes/Collection.md#byfaction).

#### Parameters

##### item

`T`

#### Returns

`string` \| `null` \| `undefined`

***

### wrap

> **wrap**: (`item`) => `V`

Defined in: [data/collection.ts:34](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/collection.ts#L34)

Wrap a raw record in its linked view.

#### Parameters

##### item

`T`

#### Returns

`V`
