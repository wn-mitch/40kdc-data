[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ResolvedModifiers

# Type Alias: ResolvedModifiers

> **ResolvedModifiers** = `object`

Defined in: [cruncher/buffs.ts:485](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L485)

Read-out of a resolved buff stack, with provenance per field.

## Properties

### hitMod

> **hitMod**: `object`

Defined in: [cruncher/buffs.ts:486](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L486)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### woundMod

> **woundMod**: `object`

Defined in: [cruncher/buffs.ts:487](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L487)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### saveMod

> **saveMod**: `object`

Defined in: [cruncher/buffs.ts:488](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L488)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### cover

> **cover**: `object`

Defined in: [cruncher/buffs.ts:489](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L489)

#### active

> **active**: `boolean`

#### source

> **source**: [`BuffSource`](BuffSource.md) \| `null`

***

### rerolls

> **rerolls**: `Partial`\<`Record`\<`"hit"` \| `"wound"` \| `"save"` \| `"damage"`, \{ `subset`: `"ones"` \| `"all-failures"`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:490](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L490)

***

### rerollOne

> **rerollOne**: `Partial`\<`Record`\<`"hit"` \| `"wound"` \| `"save"` \| `"damage"`, \{ `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:497](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L497)

One re-rolled die per roll, from a `reroll-one`; several sources still give one die.

***

### extraKeywords

> **extraKeywords**: `object`[]

Defined in: [cruncher/buffs.ts:498](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L498)

#### keywordRef

> **keywordRef**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)

#### source

> **source**: [`BuffSource`](BuffSource.md)

***

### feelNoPain

> **feelNoPain**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:500](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L500)

All-wound FNP — fires on the main and mortal damage streams alike.

***

### feelNoPainMortal

> **feelNoPainMortal**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:502](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L502)

Mortal-only FNP — fires only on the mortal-wound damage stream.

***

### damageMod

> **damageMod**: `object`

Defined in: [cruncher/buffs.ts:503](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L503)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### attacksMod

> **attacksMod**: `object`

Defined in: [cruncher/buffs.ts:504](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L504)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### strengthMod

> **strengthMod**: `object`

Defined in: [cruncher/buffs.ts:505](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L505)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### toughnessMod

> **toughnessMod**: `object`

Defined in: [cruncher/buffs.ts:506](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L506)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### apMod

> **apMod**: `object`

Defined in: [cruncher/buffs.ts:507](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L507)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### statSet

> **statSet**: `Partial`\<`Record`\<`SetStat`, \{ `value`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:509](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L509)

Ability-set weapon characteristics; an absent stat keeps the profile's value.

***

### damageReduction

> **damageReduction**: `object`

Defined in: [cruncher/buffs.ts:515](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L515)

Defender-side damage reduction. Highest-wins (multiple sources do not
stack in 10e); the dominant source is the one whose value matches the
surviving reduction.

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### damageZeroing

> **damageZeroing**: `object`

Defined in: [cruncher/buffs.ts:517](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L517)

Damage-zeroing uses, summed over sources: a pool the unit shares and uses for each model.

#### unit

> **unit**: `number`

#### model

> **model**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### invulnerable

> **invulnerable**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:523](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L523)

Ability-granted invulnerable save. Best (lowest) threshold wins. `null`
when no ability granted one; the engine still uses the unit's printed
`invuln_sv` from the profile in that case.

***

### critThresholds

> **critThresholds**: `Partial`\<`Record`\<`"hit"` \| `"wound"`, \{ `value`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:525](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L525)

Lowest critical threshold granted per roll; absent rolls crit on a 6.

***

### ignoreModifiers

> **ignoreModifiers**: `Partial`\<`Record`\<`"hit"` \| `"wound"`, \{ `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:527](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L527)

Rolls whose negative modifiers the attacker ignores.

***

### skillMod

> **skillMod**: `Record`\<`"WS"` \| `"BS"`, \{ `value`: `number`; `sources`: [`BuffSource`](BuffSource.md)[]; \}\>

Defined in: [cruncher/buffs.ts:529](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L529)

Summed WS/BS characteristic improvements.

***

### saveCharacteristic

> **saveCharacteristic**: \{ `value`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:531](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L531)

Ability-set Save characteristic; `null` keeps the printed one.

***

### saveImprove

> **saveImprove**: \{ `value`: `number`; `best`: `number`; `sources`: [`BuffSource`](BuffSource.md)[]; \} \| `null`

Defined in: [cruncher/buffs.ts:536](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L536)

Summed capped Save improvements. `best` is the most restrictive (largest) cap among the
contributions; `null` when none applies.
