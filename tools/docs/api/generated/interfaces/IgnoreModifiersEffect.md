[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / IgnoreModifiersEffect

# Interface: IgnoreModifiersEffect

Defined in: [generated.ts:3686](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3686)

[characteristic] Ignore modifiers to characteristics or rolls (all of them, or only worsening ones).

## Properties

### type

> **type**: `"ignore-modifiers"`

Defined in: [generated.ts:3687](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3687)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3688](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3688)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3689](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3689)

#### what

> **what**: `"characteristics"` \| `"rolls"`

#### stats?

> `optional` **stats?**: \[[`Stat`](../type-aliases/Stat.md), `...Stat[]`\]

##### Min Items

1

#### rolls?

> `optional` **rolls?**: \[[`RollSelector`](../type-aliases/RollSelector.md), `...RollSelector[]`\]

##### Min Items

1

#### except\_rolls?

> `optional` **except\_rolls?**: \[[`RollKind`](../type-aliases/RollKind.md), `...RollKind[]`\]

Rolls left out of an "any roll" list (rolls ["all"]): their modifiers still apply ("excluding modifiers to saving throws").

##### Min Items

1

#### only?

> `optional` **only?**: `"worsening"` \| `"improving"`

#### incoming?

> `optional` **incoming?**: `true`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3709](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3709)
