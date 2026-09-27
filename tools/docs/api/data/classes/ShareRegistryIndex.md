[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ShareRegistryIndex

# Class: ShareRegistryIndex

Defined in: [share/registry.ts:40](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/registry.ts#L40)

Bidirectional lookup over one registry, prepared once for encode/decode.

## Constructors

### Constructor

> **new ShareRegistryIndex**(`registry`): `ShareRegistryIndex`

Defined in: [share/registry.ts:47](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/registry.ts#L47)

#### Parameters

##### registry

[`ShareRegistry`](../interfaces/ShareRegistry.md)

#### Returns

`ShareRegistryIndex`

## Properties

### version

> `readonly` **version**: `number`

Defined in: [share/registry.ts:41](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/registry.ts#L41)

## Methods

### index()

> **index**(`kind`, `id`): `number` \| `undefined`

Defined in: [share/registry.ts:72](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/registry.ts#L72)

Slot for an id, or undefined if the registry doesn't know it (stale).

#### Parameters

##### kind

`"enhancement"` \| `"unit"` \| `"detachment"` \| `"wargear"` \| `"faction"` \| `"ally_rule"` \| `"disposition"`

##### id

`string`

#### Returns

`number` \| `undefined`

***

### id()

> **id**(`kind`, `index`): `string` \| `undefined`

Defined in: [share/registry.ts:77](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/registry.ts#L77)

Current id at a slot, or undefined if the slot is out of range (stale).

#### Parameters

##### kind

`"enhancement"` \| `"unit"` \| `"detachment"` \| `"wargear"` \| `"faction"` \| `"ally_rule"` \| `"disposition"`

##### index

`number`

#### Returns

`string` \| `undefined`

***

### size()

> **size**(`kind`): `number`

Defined in: [share/registry.ts:82](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/registry.ts#L82)

Number of slots in a kind.

#### Parameters

##### kind

`"enhancement"` \| `"unit"` \| `"detachment"` \| `"wargear"` \| `"faction"` \| `"ally_rule"` \| `"disposition"`

#### Returns

`number`
