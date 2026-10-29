[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / IgnoreModifiersEffect

# Interface: IgnoreModifiersEffect

Defined in: [generated.ts:3559](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3559)

[characteristic] Ignore modifiers to characteristics or rolls (all of them, or only worsening ones).

## Properties

### type

> **type**: `"ignore-modifiers"`

Defined in: [generated.ts:3560](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3560)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3561](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3561)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3562](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3562)

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

Defined in: [generated.ts:3582](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3582)
