[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / CollectionConfig

# Interface: CollectionConfig\<T, V\>

Defined in: [data/collection.ts:85](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L85)

How a [Collection](../classes/Collection.md) reads keys and builds views from raw records.

## Type Parameters

### T

`T`

### V

`V`

## Properties

### items

> **items**: `T`[]

Defined in: [data/collection.ts:86](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L86)

***

### idOf

> **idOf**: (`item`) => `string`

Defined in: [data/collection.ts:88](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L88)

Primary id of a record (e.g. `u => u.id`, `a => a.ability_id`).

#### Parameters

##### item

`T`

#### Returns

`string`

***

### dedupeKeyOf?

> `optional` **dedupeKeyOf?**: (`item`) => `string`

Defined in: [data/collection.ts:94](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L94)

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

Defined in: [data/collection.ts:96](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L96)

Display name, if the record has one — drives [Collection.find](../classes/Collection.md#find).

#### Parameters

##### item

`T`

#### Returns

`string` \| `undefined`

***

### aliasesOf?

> `optional` **aliasesOf?**: (`item`) => readonly `string`[] \| `null` \| `undefined`

Defined in: [data/collection.ts:103](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L103)

Alternate names a record answers to (spelling variants from other tools'
exports). Indexed alongside [nameOf](#nameof) so [Collection.find](../classes/Collection.md#find) /
[Collection.findAll](../classes/Collection.md#findall) match an alias exactly, but never returned as the
record's display name. The canonical name always wins a collision.

#### Parameters

##### item

`T`

#### Returns

readonly `string`[] \| `null` \| `undefined`

***

### idAliases?

> `optional` **idAliases?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [data/collection.ts:114](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L114)

Renamed-id map (old id → current id), consulted by id lookups
([Collection.get](../classes/Collection.md#get)/[Collection.getAny](../classes/Collection.md#getany)/[Collection.getInFaction](../classes/Collection.md#getinfaction)/
[Collection.has](../classes/Collection.md#has)) only when the exact id misses. Lets a persisted
reference to a since-renamed id (e.g. a saved roster or share link authored
before an enhancement id was normalized) still resolve to the current
record. The map is expected to be pre-flattened (each key maps directly to a
terminal live id), so a single hop suffices. Typically the share registry's
`aliases`.

***

### externalRefsOf?

> `optional` **externalRefsOf?**: (`item`) => readonly `object`[] \| `null` \| `undefined`

Defined in: [data/collection.ts:116](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L116)

Stable source identities indexed by [Collection.byExternalRef](../classes/Collection.md#byexternalref).

#### Parameters

##### item

`T`

#### Returns

readonly `object`[] \| `null` \| `undefined`

***

### factionOf?

> `optional` **factionOf?**: (`item`) => `string` \| `null` \| `undefined`

Defined in: [data/collection.ts:120](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L120)

Owning faction id, if applicable — drives [Collection.byFaction](../classes/Collection.md#byfaction).

#### Parameters

##### item

`T`

#### Returns

`string` \| `null` \| `undefined`

***

### guardUnscoped?

> `optional` **guardUnscoped?**: `boolean`

Defined in: [data/collection.ts:128](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L128)

When set, a faction-less [Collection.get](../classes/Collection.md#get) of an id that exists under
more than one faction throws outside production (see module docs). Use for
collections whose per-faction copies diverge (units), so callers are forced
to pass faction via [Collection.getInFaction](../classes/Collection.md#getinfaction) or opt out explicitly
with [Collection.getAny](../classes/Collection.md#getany). Requires [factionOf](#factionof).

***

### entityLabel?

> `optional` **entityLabel?**: `string`

Defined in: [data/collection.ts:134](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L134)

Noun used in the [guardUnscoped](#guardunscoped) throw message (e.g. `"unit"`,
`"detachment"`). Defaults to `"entity"`. Cosmetic — steers the error toward
the right collection without changing behaviour.

***

### gameModesOf?

> `optional` **gameModesOf?**: (`item`) => readonly `string`[] \| `null` \| `undefined`

Defined in: [data/collection.ts:141](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L141)

The record's `game_modes`, for record types that carry the field. When set,
the collection is game-mode scoped: listing methods skip records not in
[gameMode](#gamemode) (see module docs). Unset collections list every record in
every mode.

#### Parameters

##### item

`T`

#### Returns

readonly `string`[] \| `null` \| `undefined`

***

### gameMode?

> `optional` **gameMode?**: [`GameModeView`](../type-aliases/GameModeView.md)

Defined in: [data/collection.ts:143](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L143)

The mode listing methods filter to. Defaults to [DEFAULT\_GAME\_MODE](../variables/DEFAULT_GAME_MODE.md).

***

### wrap

> **wrap**: (`item`) => `V`

Defined in: [data/collection.ts:145](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L145)

Wrap a raw record in its linked view.

#### Parameters

##### item

`T`

#### Returns

`V`
