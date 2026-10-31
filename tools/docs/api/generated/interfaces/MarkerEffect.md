[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MarkerEffect

# Interface: MarkerEffect

Defined in: [generated.ts:5935](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5935)

[placement] Place, relocate or remove a marker.

## Properties

### type

> **type**: `"marker"`

Defined in: [generated.ts:5936](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5936)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5937](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5937)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5938](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5938)

#### label

> **label**: `string`

#### size\_mm?

> `optional` **size\_mm?**: `number`

Place: the diameter of the circular marker in millimetres ("a 40mm circular Tunnel Marker"). Distances measured to the marker are measured to its edge.

#### operation?

> `optional` **operation?**: `"place"` \| `"relocate"` \| `"remove"`

remove: the marker the record's condition names ("that Tunnel Marker is removed from the battlefield").

#### min\_enemy\_distance?

> `optional` **min\_enemy\_distance?**: [`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

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

#### near?

> `optional` **near?**: \[[`PlacementNear`](PlacementNear.md), `...PlacementNear[]`\]

Place: (wholly) within range of each named place ("within 1\" of that unit"). distance on a place has no stated reference point; near names one.

##### Min Items

1

#### placement?

> `optional` **placement?**: `string`

#### distance?

> `optional` **distance?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### consume?

> `optional` **consume?**: `"on-use"` \| `"never"`

#### not\_moved\_this\_turn?

> `optional` **not\_moved\_this\_turn?**: `true`

Relocate: only a marker that has not been moved this turn.

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5973](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5973)
