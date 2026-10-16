[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MoveModifierEffect

# Interface: MoveModifierEffect

Defined in: [generated.ts:4717](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4717)

[move] Change how the target's moves work.

## Properties

### type

> **type**: `"move-modifier"`

Defined in: [generated.ts:4718](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4718)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4719](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4719)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4720](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4720)

#### applies\_to\_moves?

> `optional` **applies\_to\_moves?**: \[`"normal"` \| `"advance"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"` \| `"embark"` \| `"pulse-jet"`, ...("normal" \| "advance" \| "fall-back" \| "charge" \| "pile-in" \| "consolidation" \| "ingress" \| "surge" \| "scout" \| "disembark" \| "embark" \| "pulse-jet")\[\]\]

##### Min Items

1

#### passthrough?

> `optional` **passthrough?**: \[`"terrain"` \| `"tall-terrain"` \| `"all-terrain"` \| `"models"` \| `"non-titanic-models"` \| `"terrain-le-4"` \| `"friendly-vehicles"` \| `"friendly-monsters"` \| `"models-excluding-monster-vehicle"` \| `"models-excluding-titanic"` \| `"enemy-models-excluding-monster-vehicle"` \| `"enemy-models"` \| \{ `kind`: `"terrain"` \| `"models"`; `owner?`: [`Owner`](../type-aliases/Owner.md); `all_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `excluding?`: [`KeywordList`](../type-aliases/KeywordList.md); `height?`: `"up-to-4"` \| `"over-4"`; \}, ...("terrain" \| "tall-terrain" \| "all-terrain" \| "models" \| "non-titanic-models" \| "terrain-le-4" \| "friendly-vehicles" \| "friendly-monsters" \| "models-excluding-monster-vehicle" \| "models-excluding-titanic" \| "enemy-models-excluding-monster-vehicle" \| "enemy-models" \| \{ kind: "terrain" \| "models"; owner?: Owner; all\_of?: KeywordList; excluding?: KeywordList; height?: "up-to-4" \| "over-4" \})\[\]\]

##### Min Items

1

#### ignore\_vertical?

> `optional` **ignore\_vertical?**: `true`

#### no\_end\_in\_engagement?

> `optional` **no\_end\_in\_engagement?**: `true`

#### distance\_bonus?

> `optional` **distance\_bonus?**: `string` \| `number` \| [`BattleSizeValue`](BattleSizeValue.md) \| [`RollReference`](RollReference.md) \| [`CountOf`](CountOf.md) \| [`UnitRating`](UnitRating.md)

A count, amount or value: a number, a dice expression (D3, 2D6, D6+1), one value per battle size, the result of a bound roll, or a count of something on the battlefield, or the rating the unit prints for this rule.

#### maximum?

> `optional` **maximum?**: `"unlimited"`

The selected Advance has no maximum distance. This is an explicit distance-ceiling override, not an additional move.

#### advance?

> `optional` **advance?**: `"fixed-6"`

#### end\_on\_terrain?

> `optional` **end\_on\_terrain?**: `true`

#### ends\_nearest?

> `optional` **ends\_nearest?**: [`EndsNearest2`](EndsNearest2.md)

#### ends\_when?

> `optional` **ends\_when?**: [`AbilityDSLCondition6`](../type-aliases/AbilityDSLCondition6.md)

#### ends\_when\_replaces?

> `optional` **ends\_when\_replaces?**: `true`

Only with ends_when: the ends_when condition replaces the usual end threshold ("instead of more than 8\"") rather than adding to it. Without this flag the condition adds to the usual rules.

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4824](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4824)
