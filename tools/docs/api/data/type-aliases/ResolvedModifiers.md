[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ResolvedModifiers

# Type Alias: ResolvedModifiers

> **ResolvedModifiers** = `object`

Defined in: [cruncher/buffs.ts:506](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L506)

Read-out of a resolved buff stack, with provenance per field.

## Properties

### hitMod

> **hitMod**: `object`

Defined in: [cruncher/buffs.ts:507](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L507)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### woundMod

> **woundMod**: `object`

Defined in: [cruncher/buffs.ts:508](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L508)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### saveMod

> **saveMod**: `object`

Defined in: [cruncher/buffs.ts:509](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L509)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### cover

> **cover**: `object`

Defined in: [cruncher/buffs.ts:510](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L510)

#### active

> **active**: `boolean`

#### source

> **source**: [`BuffSource`](BuffSource.md) \| `null`

***

### rerolls

> **rerolls**: `Partial`\<`Record`\<`"hit"` \| `"wound"` \| `"save"` \| `"damage"` \| `"attacks"`, \{ `subset`: `"ones"` \| `"all-failures"`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:511](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L511)

***

### rerollOne

> **rerollOne**: `Partial`\<`Record`\<`"hit"` \| `"wound"` \| `"save"` \| `"damage"`, \{ `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:518](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L518)

One re-rolled die per roll, from a `reroll-one`; several sources still give one die.

***

### extraKeywords

> **extraKeywords**: `object`[]

Defined in: [cruncher/buffs.ts:519](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L519)

#### keywordRef

> **keywordRef**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)

#### source

> **source**: [`BuffSource`](BuffSource.md)

***

### feelNoPain

> **feelNoPain**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:521](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L521)

All-wound FNP — fires on the main and mortal damage streams alike.

***

### feelNoPainMortal

> **feelNoPainMortal**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:523](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L523)

Mortal-only FNP — fires only on the mortal-wound damage stream.

***

### damageMod

> **damageMod**: `object`

Defined in: [cruncher/buffs.ts:524](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L524)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### attacksMod

> **attacksMod**: `object`

Defined in: [cruncher/buffs.ts:525](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L525)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### strengthMod

> **strengthMod**: `object`

Defined in: [cruncher/buffs.ts:526](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L526)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### toughnessMod

> **toughnessMod**: `object`

Defined in: [cruncher/buffs.ts:527](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L527)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### apMod

> **apMod**: `object`

Defined in: [cruncher/buffs.ts:528](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L528)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### statSet

> **statSet**: `Partial`\<`Record`\<`SetStat`, \{ `value`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:530](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L530)

Ability-set weapon characteristics; an absent stat keeps the profile's value.

***

### damageReduction

> **damageReduction**: `object`

Defined in: [cruncher/buffs.ts:536](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L536)

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

Defined in: [cruncher/buffs.ts:538](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L538)

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

Defined in: [cruncher/buffs.ts:544](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L544)

Ability-granted invulnerable save. Best (lowest) threshold wins. `null`
when no ability granted one; the engine still uses the unit's printed
`invuln_sv` from the profile in that case.

***

### critThresholds

> **critThresholds**: `Partial`\<`Record`\<`"hit"` \| `"wound"`, \{ `value`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:546](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L546)

Lowest critical threshold granted per roll; absent rolls crit on a 6.

***

### ignoreModifiers

> **ignoreModifiers**: `Partial`\<`Record`\<`"hit"` \| `"wound"`, \{ `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:548](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L548)

Rolls whose negative modifiers the attacker ignores.

***

### skillMod

> **skillMod**: `Record`\<`"WS"` \| `"BS"`, \{ `value`: `number`; `sources`: [`BuffSource`](BuffSource.md)[]; \}\>

Defined in: [cruncher/buffs.ts:550](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L550)

Summed WS/BS characteristic improvements.

***

### saveCharacteristic

> **saveCharacteristic**: \{ `value`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:552](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L552)

Ability-set Save characteristic; `null` keeps the printed one.

***

### saveImprove

> **saveImprove**: \{ `value`: `number`; `best`: `number`; `sources`: [`BuffSource`](BuffSource.md)[]; \} \| `null`

Defined in: [cruncher/buffs.ts:557](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L557)

Summed capped Save improvements. `best` is the most restrictive (largest) cap among the
contributions; `null` when none applies.

***

### rollMortals

> **rollMortals**: `object`[]

Defined in: [cruncher/buffs.ts:559](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L559)

Mortal wounds the attack's own rolls inflict, one entry per source; they stack.

#### roll

> **roll**: `"hit"` \| `"wound"`

#### outcome

> **outcome**: `"success"` \| `"critical"`

#### count

> **count**: `number`

#### source

> **source**: [`BuffSource`](BuffSource.md)
