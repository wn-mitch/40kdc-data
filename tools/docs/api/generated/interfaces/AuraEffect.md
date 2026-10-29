[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AuraEffect

# Interface: AuraEffect

Defined in: [generated.ts:4078](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4078)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "aura-effect".

## Properties

### type

> **type**: `"aura"`

Defined in: [generated.ts:4079](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4079)

***

### target

> **target**: `"enemy-within-aura"` \| `"friendly-within-aura"`

Defined in: [generated.ts:4080](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4080)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4081](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4081)

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### range\_bonus?

> `optional` **range\_bonus?**: [`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

One reference for every distance. A per_battle_round table is indexed from battle round 1; each later round uses the next entry and the final entry continues for all subsequent rounds. Tier entries are non-tiered range refs, so nested tables are forbidden.

##### Union Members

[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md)

***

###### Type Literal

\{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

###### per\_battle\_round

> **per\_battle\_round**: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]

###### Min Items

1

#### of?

> `optional` **of?**: `string`

#### effect?

> `optional` **effect?**: [`EffectNode`](../type-aliases/EffectNode.md)

#### eligible?

> `optional` **eligible?**: [`UnitFilter`](UnitFilter.md)

#### emitter\_filter?

> `optional` **emitter\_filter?**: [`UnitFilter`](UnitFilter.md)

#### recipient\_filter?

> `optional` **recipient\_filter?**: [`UnitFilter`](UnitFilter.md)

#### range\_cap?

> `optional` **range\_cap?**: [`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

One reference for every distance. A per_battle_round table is indexed from battle round 1; each later round uses the next entry and the final entry continues for all subsequent rounds. Tier entries are non-tiered range refs, so nested tables are forbidden.

##### Union Members

[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md)

***

###### Type Literal

\{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

###### per\_battle\_round

> **per\_battle\_round**: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]

###### Min Items

1

#### wholly?

> `optional` **wholly?**: `true`

The unit must be wholly within the range (no part of it outside), not merely within it (any part inside).
