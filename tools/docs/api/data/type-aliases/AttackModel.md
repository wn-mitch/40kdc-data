[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / AttackModel

# Type Alias: AttackModel

> **AttackModel** = `object`

Defined in: [cruncher/engine.ts:56](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L56)

The per-roll parameters behind one crunch, for the discrete allocation stage
(`allocation.ts`): every probability is the one the expected-value stages use.

## Properties

### modelsFiring

> **modelsFiring**: `number`

Defined in: [cruncher/engine.ts:57](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L57)

***

### attacksStat

> **attacksStat**: `unknown`

Defined in: [cruncher/engine.ts:59](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L59)

One model's Attacks characteristic, before the flat additions below.

***

### attacksReroll?

> `optional` **attacksReroll?**: `"ones"` \| `"all-failures"`

Defined in: [cruncher/engine.ts:61](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L61)

A re-roll of the Attacks dice, kept when at or above a fresh roll's mean.

***

### attacksBonus

> **attacksBonus**: `number`

Defined in: [cruncher/engine.ts:63](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L63)

Flat attacks every model adds: the modifier and Blast.

***

### rapidFireStat

> **rapidFireStat**: `unknown`

Defined in: [cruncher/engine.ts:65](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L65)

Rapid Fire's extra attacks per model when active, else null.

***

### torrent

> **torrent**: `boolean`

Defined in: [cruncher/engine.ts:66](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L66)

***

### hit

> **hit**: `object`

Defined in: [cruncher/engine.ts:67](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L67)

#### pass

> **pass**: `number`

#### crit

> **crit**: `number`

***

### sustainedStat

> **sustainedStat**: `unknown`

Defined in: [cruncher/engine.ts:69](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L69)

Sustained Hits' extra hits per critical hit, else null.

***

### lethal

> **lethal**: `boolean`

Defined in: [cruncher/engine.ts:70](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L70)

***

### wound

> **wound**: `object`

Defined in: [cruncher/engine.ts:71](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L71)

#### pass

> **pass**: `number`

#### crit

> **crit**: `number`

***

### devastating

> **devastating**: `boolean`

Defined in: [cruncher/engine.ts:72](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L72)

***

### unsaved

> **unsaved**: `number`

Defined in: [cruncher/engine.ts:74](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L74)

Probability a wound that reaches the save is not saved.

***

### damage

> **damage**: `object`[]

Defined in: [cruncher/engine.ts:76](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L76)

Final per-attack damage.

#### value

> **value**: `number`

#### probability

> **probability**: `number`

***

### criticalWound?

> `optional` **criticalWound?**: `object`

Defined in: [cruncher/engine.ts:82](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L82)

A critical wound's own save failure and Damage, present only when a buff applies only on a
critical wound. A critical wound is one the wound roll scores, not a Lethal Hits wound; with
Devastating Wounds it skips the save and its mortal wounds deal this Damage.

#### unsaved

> **unsaved**: `number`

#### damage

> **damage**: `object`[]

***

### woundLost

> **woundLost**: `number`

Defined in: [cruncher/engine.ts:84](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L84)

Probability each wound is lost despite Feel No Pain: on every wound, and on mortal wounds only.

***

### mortalWoundLost

> **mortalWoundLost**: `number`

Defined in: [cruncher/engine.ts:85](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L85)

***

### wounds

> **wounds**: `number`

Defined in: [cruncher/engine.ts:86](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L86)

***

### modelCount

> **modelCount**: `number`

Defined in: [cruncher/engine.ts:87](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L87)

***

### unmodelled

> **unmodelled**: `string`[]

Defined in: [cruncher/engine.ts:93](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L93)

What the expected stages price that the exact allocation does not model: a single re-rolled
die over the whole unit (its attacks are no longer independent) and mortal wounds an ability
inflicts on a roll. Allocation refuses a model listing any rather than return a result without them.
