[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MoveEffect

# Interface: MoveEffect

Defined in: [generated.ts:4594](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4594)

[move] The target makes a move now. A surge move carries its core limit (21.02).

## Properties

### type

> **type**: `"move"`

Defined in: [generated.ts:4595](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4595)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4596](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4596)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4597](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4597)

#### move\_type

> **move\_type**: `"normal"` \| `"advance"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"` \| `"embark"` \| `"pulse-jet"`

#### distance?

> `optional` **distance?**: [`Quantity`](../type-aliases/Quantity.md)

#### as\_if?

> `optional` **as\_if?**: `"movement-phase"`

The move is made as if it were your Movement phase, outside it.

#### passthrough?

> `optional` **passthrough?**: \[`"terrain"` \| `"tall-terrain"` \| `"all-terrain"` \| `"models"` \| `"non-titanic-models"` \| `"terrain-le-4"` \| `"friendly-vehicles"` \| `"friendly-monsters"` \| `"models-excluding-monster-vehicle"` \| `"models-excluding-titanic"` \| `"enemy-models-excluding-monster-vehicle"` \| `"enemy-models"` \| \{ `kind`: `"terrain"` \| `"models"`; `owner?`: [`Owner`](../type-aliases/Owner.md); `all_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `excluding?`: [`KeywordList`](../type-aliases/KeywordList.md); `height?`: `"up-to-4"` \| `"over-4"`; \}, ...("terrain" \| "tall-terrain" \| "all-terrain" \| "models" \| "non-titanic-models" \| "terrain-le-4" \| "friendly-vehicles" \| "friendly-monsters" \| "models-excluding-monster-vehicle" \| "models-excluding-titanic" \| "enemy-models-excluding-monster-vehicle" \| "enemy-models" \| \{ kind: "terrain" \| "models"; owner?: Owner; all\_of?: KeywordList; excluding?: KeywordList; height?: "up-to-4" \| "over-4" \})\[\]\]

##### Min Items

1

#### mode?

> `optional` **mode?**: [`MoveMode`](../type-aliases/MoveMode.md)

#### allow\_engagement?

> `optional` **allow\_engagement?**: `true`

#### engaged\_with?

> `optional` **engaged\_with?**: `"nearest-move-end"`

allow_engagement is bound to the enemy unit the move ends nearest (ends_nearest.of): models may end within Engagement Range of that unit. Needs ends_nearest.

#### counts\_as\_move?

> `optional` **counts\_as\_move?**: `"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"` \| `"embark"` \| `"pulse-jet"`

The move counts as this kind of move for rules that check what the unit did this turn.

#### ends\_within?

> `optional` **ends\_within?**: `object`

##### ends\_within.range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

##### ends\_within.of?

> `optional` **of?**: [`PlaceRef`](../type-aliases/PlaceRef.md)

##### ends\_within.wholly?

> `optional` **wholly?**: `true`

#### ends\_when?

> `optional` **ends\_when?**: [`AbilityDSLCondition5`](../type-aliases/AbilityDSLCondition5.md)

#### keeps\_eligible?

> `optional` **keeps\_eligible?**: `true`

#### ends\_nearest?

> `optional` **ends\_nearest?**: [`EndsNearest1`](EndsNearest1.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4699](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4699)
