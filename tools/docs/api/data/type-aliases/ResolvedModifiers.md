[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ResolvedModifiers

# Type Alias: ResolvedModifiers

> **ResolvedModifiers** = `object`

Defined in: [cruncher/buffs.ts:173](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L173)

Read-out of a resolved buff stack, with provenance per field.

## Properties

### hitMod

> **hitMod**: `object`

Defined in: [cruncher/buffs.ts:174](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L174)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### woundMod

> **woundMod**: `object`

Defined in: [cruncher/buffs.ts:175](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L175)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### saveMod

> **saveMod**: `object`

Defined in: [cruncher/buffs.ts:176](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L176)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### cover

> **cover**: `object`

Defined in: [cruncher/buffs.ts:177](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L177)

#### active

> **active**: `boolean`

#### source

> **source**: [`BuffSource`](BuffSource.md) \| `null`

***

### rerolls

> **rerolls**: `Partial`\<`Record`\<`"hit"` \| `"wound"` \| `"save"` \| `"damage"`, \{ `subset`: `"ones"` \| `"all-failures"`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:178](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L178)

***

### extraKeywords

> **extraKeywords**: `object`[]

Defined in: [cruncher/buffs.ts:184](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L184)

#### keywordRef

> **keywordRef**: [`WeaponKeywordRef`](WeaponKeywordRef.md)

#### source

> **source**: [`BuffSource`](BuffSource.md)

***

### feelNoPain

> **feelNoPain**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:186](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L186)

All-wound FNP — fires on the main and mortal damage streams alike.

***

### feelNoPainMortal

> **feelNoPainMortal**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:188](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L188)

Mortal-only FNP — fires only on the mortal-wound damage stream.

***

### damageMod

> **damageMod**: `object`

Defined in: [cruncher/buffs.ts:189](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L189)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### attacksMod

> **attacksMod**: `object`

Defined in: [cruncher/buffs.ts:190](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L190)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### strengthMod

> **strengthMod**: `object`

Defined in: [cruncher/buffs.ts:191](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L191)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### toughnessMod

> **toughnessMod**: `object`

Defined in: [cruncher/buffs.ts:192](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L192)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### apMod

> **apMod**: `object`

Defined in: [cruncher/buffs.ts:193](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L193)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### damageReduction

> **damageReduction**: `object`

Defined in: [cruncher/buffs.ts:199](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L199)

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

Defined in: [cruncher/buffs.ts:205](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L205)

Ability-granted invulnerable save. Best (lowest) threshold wins. `null`
when no ability granted one; the engine still uses the unit's printed
`invuln_sv` from the profile in that case.
