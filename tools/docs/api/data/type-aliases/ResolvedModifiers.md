[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ResolvedModifiers

# Type Alias: ResolvedModifiers

> **ResolvedModifiers** = `object`

Defined in: [cruncher/buffs.ts:160](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L160)

Read-out of a resolved buff stack, with provenance per field.

## Properties

### hitMod

> **hitMod**: `object`

Defined in: [cruncher/buffs.ts:161](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L161)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### woundMod

> **woundMod**: `object`

Defined in: [cruncher/buffs.ts:162](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L162)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### saveMod

> **saveMod**: `object`

Defined in: [cruncher/buffs.ts:163](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L163)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### cover

> **cover**: `object`

Defined in: [cruncher/buffs.ts:164](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L164)

#### active

> **active**: `boolean`

#### source

> **source**: [`BuffSource`](BuffSource.md) \| `null`

***

### rerolls

> **rerolls**: `Partial`\<`Record`\<`"hit"` \| `"wound"` \| `"save"` \| `"damage"`, \{ `subset`: `"ones"` \| `"all-failures"`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:165](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L165)

***

### extraKeywords

> **extraKeywords**: `object`[]

Defined in: [cruncher/buffs.ts:171](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L171)

#### keywordRef

> **keywordRef**: [`WeaponKeywordRef`](WeaponKeywordRef.md)

#### source

> **source**: [`BuffSource`](BuffSource.md)

***

### feelNoPain

> **feelNoPain**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:173](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L173)

All-wound FNP — fires on the main and mortal damage streams alike.

***

### feelNoPainMortal

> **feelNoPainMortal**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:175](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L175)

Mortal-only FNP — fires only on the mortal-wound damage stream.

***

### damageMod

> **damageMod**: `object`

Defined in: [cruncher/buffs.ts:176](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L176)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### attacksMod

> **attacksMod**: `object`

Defined in: [cruncher/buffs.ts:177](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L177)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### strengthMod

> **strengthMod**: `object`

Defined in: [cruncher/buffs.ts:178](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L178)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### toughnessMod

> **toughnessMod**: `object`

Defined in: [cruncher/buffs.ts:179](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L179)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### apMod

> **apMod**: `object`

Defined in: [cruncher/buffs.ts:180](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L180)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### damageReduction

> **damageReduction**: `object`

Defined in: [cruncher/buffs.ts:186](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L186)

Defender-side damage reduction. Highest-wins (multiple sources do not
stack in 10e); the dominant source is the one whose value matches the
surviving reduction.

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### invulnerable

> **invulnerable**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:192](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L192)

Ability-granted invulnerable save. Best (lowest) threshold wins. `null`
when no ability granted one; the engine still uses the unit's printed
`invuln_sv` from the profile in that case.
