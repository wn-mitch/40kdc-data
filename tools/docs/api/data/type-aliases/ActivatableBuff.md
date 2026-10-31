[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ActivatableBuff

# Type Alias: ActivatableBuff

> **ActivatableBuff** = `object`

Defined in: [cruncher/from-dsl.ts:99](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L99)

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

Defined in: [cruncher/from-dsl.ts:101](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L101)

Stable toggle id, e.g. `"blessings-of-khorne#Warp Blades"`.

***

### label

> **label**: `string`

Defined in: [cruncher/from-dsl.ts:103](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L103)

Human label for the lever (option name, or a summary of its buffs).

***

### buffs

> **buffs**: [`Buff`](Buff.md)[]

Defined in: [cruncher/from-dsl.ts:105](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L105)

Contributions this activation adds when the player opts in (≥1, or none for a [capRaise](#capraise) lever).

***

### group?

> `optional` **group?**: [`ActivatableGroupRef`](ActivatableGroupRef.md)

Defined in: [cruncher/from-dsl.ts:107](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L107)

Set when the lever belongs to a mutually-limited pool.

***

### capRaise?

> `optional` **capRaise?**: `object`

Defined in: [cruncher/from-dsl.ts:112](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L112)

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

Defined in: [cruncher/from-dsl.ts:114](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L114)

All enclosing activation pools apply, in addition to the option's own group.

***

### requires?

> `optional` **requires?**: `unknown`[]

Defined in: [cruncher/from-dsl.ts:120](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L120)

DSL fragments the player vouches for when opting in, in the order they apply: a unit
selection (its range, visibility and eligibility), a gating roll, a model count. Absent when
the lever assumes nothing beyond the choice itself.

***

### requiresOption?

> `optional` **requiresOption?**: `StanceOptionRef`

Defined in: [cruncher/from-dsl.ts:125](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L125)

The stance option the lever applies under: a `rule-active` gate on an option the context's
`activeRules` does not declare. The lever pool binds it to that option's own lever.

***

### excludesOption?

> `optional` **excludesOption?**: `StanceOptionRef`

Defined in: [cruncher/from-dsl.ts:127](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L127)

The stance option the lever does not apply under: a negated `rule-active` gate on it.
