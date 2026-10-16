[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ActivatableBuff

# Type Alias: ActivatableBuff

> **ActivatableBuff** = `object`

Defined in: [cruncher/from-dsl.ts:73](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/from-dsl.ts#L73)

A buff-bearing *player decision* the cruncher can't make on its own: a
dice-pool option, a `choice` branch, or an activation gated on a timing the
player controls (e.g. "start of phase"). It is not auto-applied — the
consumer opts in (a checkbox, or an optimizer's search) and then folds
[buffs](#buffs) into the crunch. Conditions the activation still carries (a
target keyword, a phase) ride on each buff's `applicableWhen`, so the
resolver gates them per-target rather than the lever vanishing.

## Properties

### id

> **id**: `string`

Defined in: [cruncher/from-dsl.ts:75](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/from-dsl.ts#L75)

Stable toggle id, e.g. `"blessings-of-khorne#Warp Blades"`.

***

### label

> **label**: `string`

Defined in: [cruncher/from-dsl.ts:77](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/from-dsl.ts#L77)

Human label for the lever (option name, or a summary of its buffs).

***

### buffs

> **buffs**: [`Buff`](Buff.md)[]

Defined in: [cruncher/from-dsl.ts:79](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/from-dsl.ts#L79)

Contributions this activation adds when the player opts in (≥1, or none for a [capRaise](#capraise) lever).

***

### group?

> `optional` **group?**: [`ActivatableGroupRef`](ActivatableGroupRef.md)

Defined in: [cruncher/from-dsl.ts:81](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/from-dsl.ts#L81)

Set when the lever belongs to a mutually-limited pool.

***

### capRaise?

> `optional` **capRaise?**: `object`

Defined in: [cruncher/from-dsl.ts:86](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/from-dsl.ts#L86)

The lever raises the cap of another ability's lever pool instead of adding buffs ("select one
more augmentation"): `ability` names that ability as the DSL does, `by` the extra activations.

#### ability

> **ability**: `string`

#### by

> **by**: `number`

#### allocation

> **allocation**: `"choose-one-option"` \| `"fixed-option"`

#### option?

> `optional` **option?**: `object`

##### option.ability\_id

> **ability\_id**: `string`

##### option.option\_id

> **option\_id**: `string`

#### options?

> `optional` **options?**: `object`[]

***

### groups?

> `optional` **groups?**: [`ActivatableGroupRef`](ActivatableGroupRef.md)[]

Defined in: [cruncher/from-dsl.ts:88](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/from-dsl.ts#L88)

All enclosing activation pools apply, in addition to the option's own group.

***

### requires?

> `optional` **requires?**: `unknown`[]

Defined in: [cruncher/from-dsl.ts:94](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/from-dsl.ts#L94)

DSL fragments the player vouches for when opting in, in the order they apply: a unit
selection (its range, visibility and eligibility), a gating roll, a model count. Absent when
the lever assumes nothing beyond the choice itself.
