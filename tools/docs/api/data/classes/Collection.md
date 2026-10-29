[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / Collection

# Class: Collection\<T, V\>

Defined in: [data/collection.ts:173](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L173)

A collection of one entity type, exposing id/name/faction lookups.

Iterable: `for (const unit of units) { … }`.

## Type Parameters

### T

`T`

the raw (generated) record type

### V

`V`

the linked view type returned to callers

## Implements

- `Iterable`\<`V`\>

## Constructors

### Constructor

> **new Collection**\<`T`, `V`\>(`cfg`): `Collection`\<`T`, `V`\>

Defined in: [data/collection.ts:181](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L181)

#### Parameters

##### cfg

[`CollectionConfig`](../interfaces/CollectionConfig.md)\<`T`, `V`\>

#### Returns

`Collection`\<`T`, `V`\>

## Properties

### gameMode

> `readonly` **gameMode**: [`GameModeView`](../type-aliases/GameModeView.md)

Defined in: [data/collection.ts:177](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L177)

The game mode listing methods filter to.

## Accessors

### all

#### Get Signature

> **get** **all**(): `V`[]

Defined in: [data/collection.ts:222](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L222)

Every record, deduplicated by id, in first-seen order.

##### Returns

`V`[]

***

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [data/collection.ts:227](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L227)

Number of distinct records.

##### Returns

`number`

## Methods

### withGameMode()

> **withGameMode**(`mode`, `wrap?`): `Collection`\<`T`, `V`\>

Defined in: [data/collection.ts:193](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L193)

A view of this collection listing `mode` instead, sharing every index (no
rebuild). `wrap` re-binds linked views to the caller's dataset view;
omitted, records wrap as they do here.

#### Parameters

##### mode

[`GameModeView`](../type-aliases/GameModeView.md)

##### wrap?

(`item`) => `V`

#### Returns

`Collection`\<`T`, `V`\>

***

### get()

> **get**(`id`): `V` \| `undefined`

Defined in: [data/collection.ts:238](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L238)

Look up by exact id. For a guarded collection (see
[CollectionConfig.guardUnscoped](../interfaces/CollectionConfig.md#guardunscoped)), an id that exists under more than
one faction throws outside production — pass a faction via
[getInFaction](#getinfaction), or call [getAny](#getany) when faction is genuinely
unknown. In production this degrades to first-wins.

#### Parameters

##### id

`string`

#### Returns

`V` \| `undefined`

***

### getAny()

> **getAny**(`id`): `V` \| `undefined`

Defined in: [data/collection.ts:269](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L269)

First-wins lookup by exact id that never throws, for callers with no
faction context on purpose (roster import, the conformance runner). For a
guarded collection this is the explicit opt-out of [get](#get)'s ambiguity
tripwire; for an unguarded one it is identical to [get](#get).

#### Parameters

##### id

`string`

#### Returns

`V` \| `undefined`

***

### getInFaction()

> **getInFaction**(`id`, `factionId`): `V` \| `undefined`

Defined in: [data/collection.ts:281](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L281)

Look up by exact id *within a faction*. Use this when an id is shared
across factions (e.g. `chaos-land-raider` lives under five Chaos factions)
and a faction context is known — [get](#get) would return whichever copy
was registered first, which may belong to the wrong faction. Returns
`undefined` when no record with that id belongs to `factionId`.

#### Parameters

##### id

`string`

##### factionId

`string`

#### Returns

`V` \| `undefined`

***

### has()

> **has**(`id`): `boolean`

Defined in: [data/collection.ts:292](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L292)

Whether a record with this exact id (or a renamed alias of it) exists.

#### Parameters

##### id

`string`

#### Returns

`boolean`

***

### byExternalRef()

> **byExternalRef**(`namespace`, `id`): `V`[]

Defined in: [data/collection.ts:301](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L301)

Return every canonical record carrying an exact external source identity.
External mappings are many-to-many: several records may share one source
identity, and one record may carry several ids from the same namespace.

#### Parameters

##### namespace

`string`

##### id

`string`

#### Returns

`V`[]

***

### find()

> **find**(`query`): `V` \| `undefined`

Defined in: [data/collection.ts:319](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L319)

Find one record by id or name. Name matching is diacritic- and
punctuation-insensitive (see [normalizeName](../functions/normalizeName.md)), trying, in order:
exact id → exact normalized name → normalized-name substring. Returns the
first match; names can repeat across factions, so use [findAll](#findall) or
[byFaction](#byfaction) when a query may be ambiguous.

#### Parameters

##### query

`string`

#### Returns

`V` \| `undefined`

#### Example

```ts
units.find("Kharn"); // resolves "Khârn the Betrayer"
```

***

### findAll()

> **findAll**(`query`): `V`[]

Defined in: [data/collection.ts:332](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L332)

All records matching a query, by the same rules as [find](#find). An exact id
match returns just that record; otherwise every normalized-name-exact match
is returned, falling back to every normalized-name-substring match. Useful
to surface (rather than silently collapse) names shared across factions.
Every step skips records outside this view's game mode, the exact-id step
included: a name search lists, so it never returns a hidden record (use
[getAny](#getany) to resolve one by id).

#### Parameters

##### query

`string`

#### Returns

`V`[]

***

### byFaction()

> **byFaction**(`factionId`): `V`[]

Defined in: [data/collection.ts:351](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L351)

All records belonging to a faction id that this view's game mode lists
(empty if the type has no faction).

#### Parameters

##### factionId

`string`

#### Returns

`V`[]

***

### \[iterator\]()

> **\[iterator\]**(): `Iterator`\<`V`\>

Defined in: [data/collection.ts:357](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L357)

#### Returns

`Iterator`\<`V`\>

#### Implementation of

`Iterable.[iterator]`
