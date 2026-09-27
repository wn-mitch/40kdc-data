[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / CollectionConfig

# Interface: CollectionConfig\<T, V\>

Defined in: [data/collection.ts:38](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L38)

How a [Collection](../classes/Collection.md) reads keys and builds views from raw records.

## Type Parameters

### T

`T`

### V

`V`

## Properties

### items

> **items**: `T`[]

Defined in: [data/collection.ts:39](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L39)

***

### idOf

> **idOf**: (`item`) => `string`

Defined in: [data/collection.ts:41](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L41)

Primary id of a record (e.g. `u => u.id`, `a => a.ability_id`).

#### Parameters

##### item

`T`

#### Returns

`string`

***

### dedupeKeyOf?

> `optional` **dedupeKeyOf?**: (`item`) => `string`

Defined in: [data/collection.ts:47](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L47)

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

Defined in: [data/collection.ts:49](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L49)

Display name, if the record has one — drives [Collection.find](../classes/Collection.md#find).

#### Parameters

##### item

`T`

#### Returns

`string` \| `undefined`

***

### aliasesOf?

> `optional` **aliasesOf?**: (`item`) => readonly `string`[] \| `null` \| `undefined`

Defined in: [data/collection.ts:56](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L56)

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

Defined in: [data/collection.ts:67](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L67)

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

Defined in: [data/collection.ts:69](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L69)

Stable source identities indexed by [Collection.byExternalRef](../classes/Collection.md#byexternalref).

#### Parameters

##### item

`T`

#### Returns

readonly `object`[] \| `null` \| `undefined`

***

### factionOf?

> `optional` **factionOf?**: (`item`) => `string` \| `null` \| `undefined`

Defined in: [data/collection.ts:73](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L73)

Owning faction id, if applicable — drives [Collection.byFaction](../classes/Collection.md#byfaction).

#### Parameters

##### item

`T`

#### Returns

`string` \| `null` \| `undefined`

***

### guardUnscoped?

> `optional` **guardUnscoped?**: `boolean`

Defined in: [data/collection.ts:81](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L81)

When set, a faction-less [Collection.get](../classes/Collection.md#get) of an id that exists under
more than one faction throws outside production (see module docs). Use for
collections whose per-faction copies diverge (units), so callers are forced
to pass faction via [Collection.getInFaction](../classes/Collection.md#getinfaction) or opt out explicitly
with [Collection.getAny](../classes/Collection.md#getany). Requires [factionOf](#factionof).

***

### entityLabel?

> `optional` **entityLabel?**: `string`

Defined in: [data/collection.ts:87](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L87)

Noun used in the [guardUnscoped](#guardunscoped) throw message (e.g. `"unit"`,
`"detachment"`). Defaults to `"entity"`. Cosmetic — steers the error toward
the right collection without changing behaviour.

***

### wrap

> **wrap**: (`item`) => `V`

Defined in: [data/collection.ts:89](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/collection.ts#L89)

Wrap a raw record in its linked view.

#### Parameters

##### item

`T`

#### Returns

`V`
