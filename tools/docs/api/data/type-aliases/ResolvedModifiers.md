[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ResolvedModifiers

# Type Alias: ResolvedModifiers

> **ResolvedModifiers** = `object`

Defined in: [cruncher/buffs.ts:234](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L234)

Read-out of a resolved buff stack, with provenance per field.

## Properties

### hitMod

> **hitMod**: `object`

Defined in: [cruncher/buffs.ts:235](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L235)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### woundMod

> **woundMod**: `object`

Defined in: [cruncher/buffs.ts:236](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L236)

#### value

> **value**: `number`

#### dominantSource

> **dominantSource**: [`BuffSource`](BuffSource.md) \| `null`

***

### saveMod

> **saveMod**: `object`

Defined in: [cruncher/buffs.ts:237](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L237)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### cover

> **cover**: `object`

Defined in: [cruncher/buffs.ts:238](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L238)

#### active

> **active**: `boolean`

#### source

> **source**: [`BuffSource`](BuffSource.md) \| `null`

***

### rerolls

> **rerolls**: `Partial`\<`Record`\<`"hit"` \| `"wound"` \| `"save"` \| `"damage"`, \{ `subset`: `"ones"` \| `"all-failures"`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:239](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L239)

***

### extraKeywords

> **extraKeywords**: `object`[]

Defined in: [cruncher/buffs.ts:245](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L245)

#### keywordRef

> **keywordRef**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)

#### source

> **source**: [`BuffSource`](BuffSource.md)

***

### feelNoPain

> **feelNoPain**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:247](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L247)

All-wound FNP — fires on the main and mortal damage streams alike.

***

### feelNoPainMortal

> **feelNoPainMortal**: \{ `threshold`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:249](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L249)

Mortal-only FNP — fires only on the mortal-wound damage stream.

***

### damageMod

> **damageMod**: `object`

Defined in: [cruncher/buffs.ts:250](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L250)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### attacksMod

> **attacksMod**: `object`

Defined in: [cruncher/buffs.ts:251](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L251)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### strengthMod

> **strengthMod**: `object`

Defined in: [cruncher/buffs.ts:252](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L252)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### toughnessMod

> **toughnessMod**: `object`

Defined in: [cruncher/buffs.ts:253](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L253)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### apMod

> **apMod**: `object`

Defined in: [cruncher/buffs.ts:254](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L254)

#### value

> **value**: `number`

#### sources

> **sources**: [`BuffSource`](BuffSource.md)[]

***

### damageReduction

> **damageReduction**: `object`

Defined in: [cruncher/buffs.ts:260](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L260)

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

Defined in: [cruncher/buffs.ts:266](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L266)

Ability-granted invulnerable save. Best (lowest) threshold wins. `null`
when no ability granted one; the engine still uses the unit's printed
`invuln_sv` from the profile in that case.

***

### critThresholds

> **critThresholds**: `Partial`\<`Record`\<`"hit"` \| `"wound"`, \{ `value`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:268](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L268)

Lowest critical threshold granted per roll; absent rolls crit on a 6.

***

### ignoreModifiers

> **ignoreModifiers**: `Partial`\<`Record`\<`"hit"` \| `"wound"`, \{ `dominantSource`: [`BuffSource`](BuffSource.md); \}\>\>

Defined in: [cruncher/buffs.ts:270](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L270)

Rolls whose negative modifiers the attacker ignores.

***

### skillMod

> **skillMod**: `Record`\<`"WS"` \| `"BS"`, \{ `value`: `number`; `sources`: [`BuffSource`](BuffSource.md)[]; \}\>

Defined in: [cruncher/buffs.ts:272](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L272)

Summed WS/BS characteristic improvements.

***

### saveCharacteristic

> **saveCharacteristic**: \{ `value`: `number`; `dominantSource`: [`BuffSource`](BuffSource.md); \} \| `null`

Defined in: [cruncher/buffs.ts:274](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L274)

Ability-set Save characteristic; `null` keeps the printed one.
