[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / BuffApplicability

# Type Alias: BuffApplicability

> **BuffApplicability** = `object`

Defined in: [cruncher/buffs.ts:95](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L95)

Optional gating; the resolver drops buffs whose gate fails.

## Properties

### phases?

> `optional` **phases?**: [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [cruncher/buffs.ts:96](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L96)

***

### rollType?

> `optional` **rollType?**: `"hit"` \| `"wound"` \| `"save"` \| `"damage"`

Defined in: [cruncher/buffs.ts:97](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L97)

***

### requiresTargetKeyword?

> `optional` **requiresTargetKeyword?**: `string`

Defined in: [cruncher/buffs.ts:99](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L99)

Target must carry this keyword (case-insensitive).

***

### requiresAttackerKeyword?

> `optional` **requiresAttackerKeyword?**: `string`

Defined in: [cruncher/buffs.ts:101](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L101)

Attacker must carry this keyword (case-insensitive).
