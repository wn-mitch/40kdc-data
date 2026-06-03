[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityDSLEntry

# Interface: AbilityDSLEntry

Defined in: [generated.ts:1400](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1400)

Community-authored structured representation of what a game ability does. NOT GW text.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability".

## Properties

### ability\_id

> **ability\_id**: `string`

Defined in: [generated.ts:1401](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1401)

***

### name

> **name**: `string`

Defined in: [generated.ts:1402](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1402)

***

### authored\_by

> **authored\_by**: `string`

Defined in: [generated.ts:1403](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1403)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1404](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1404)

***

### version?

> `optional` **version?**: `string`

Defined in: [generated.ts:1405](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1405)

***

### supersedes?

> `optional` **supersedes?**: `string` \| `null`

Defined in: [generated.ts:1406](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1406)

***

### unit\_ids?

> `optional` **unit\_ids?**: `string`[]

Defined in: [generated.ts:1407](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1407)

***

### faction\_id?

> `optional` **faction\_id?**: `string` \| `null`

Defined in: [generated.ts:1411](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1411)

For faction-type abilities, the faction this rule belongs to

***

### detachment\_id?

> `optional` **detachment\_id?**: `string` \| `null`

Defined in: [generated.ts:1415](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1415)

For detachment/enhancement/stratagem-type abilities, the associated detachment

***

### ability\_type?

> `optional` **ability\_type?**: `"stratagem"` \| `"enhancement"` \| `"unit"` \| `"core"` \| `"detachment"` \| `"faction"`

Defined in: [generated.ts:1416](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1416)

***

### behavior?

> `optional` **behavior?**: `"passive"` \| `"activated"` \| `"reactive"` \| `"aura"`

Defined in: [generated.ts:1420](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1420)

How this ability interacts with the game flow — not a runtime predicate

***

### effect

> **effect**: [`AbilityEffect1`](../type-aliases/AbilityEffect1.md)

Defined in: [generated.ts:1421](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1421)

***

### scope

> **scope**: [`AbilityScope`](AbilityScope.md)

Defined in: [generated.ts:1422](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1422)

***

### interactions?

> `optional` **interactions?**: `object`[]

Defined in: [generated.ts:1423](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1423)

#### Index Signature

\[`k`: `string`\]: `unknown`

#### ability\_ref

> **ability\_ref**: `string`

#### type

> **type**: `"conflicts-with"` \| `"combos-with"` \| `"superseded-by"` \| `"requires"` \| `"replaces"`

#### notes?

> `optional` **notes?**: `string`

***

### disputed?

> `optional` **disputed?**: `boolean`

Defined in: [generated.ts:1429](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1429)

***

### dispute\_notes?

> `optional` **dispute\_notes?**: `string`

Defined in: [generated.ts:1430](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1430)

***

### community\_notes?

> `optional` **community\_notes?**: `string`

Defined in: [generated.ts:1431](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1431)
