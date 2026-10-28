[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MoveModifierEffect

# Interface: MoveModifierEffect

Defined in: [generated.ts:5329](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5329)

[move] Change how the target's moves work.

## Properties

### type

> **type**: `"move-modifier"`

Defined in: [generated.ts:5330](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5330)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5331](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5331)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5332](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5332)

#### applies\_to\_moves?

> `optional` **applies\_to\_moves?**: \[`"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"` \| `"embark"` \| `"pulse-jet"`, ...("normal" \| "advance" \| "remain-stationary" \| "fall-back" \| "charge" \| "pile-in" \| "consolidation" \| "ingress" \| "surge" \| "scout" \| "disembark" \| "embark" \| "pulse-jet")\[\]\]

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

> `optional` **distance\_bonus?**: [`Quantity`](../type-aliases/Quantity.md)

A distance bonus for the selected move; a negative integer shortens it ("-2\" from that pile-in move"). Numeric strings are not accepted.

#### maximum?

> `optional` **maximum?**: `number` \| `"unlimited"`

unlimited: the selected Advance has no maximum distance. A number: the selected moves can go up to that many inches ("that unit can move up to 4\""). An explicit distance ceiling, not an additional move.

#### advance?

> `optional` **advance?**: `"fixed-6"` \| `"fixed-8"`

Advance without an Advance roll, adding this many inches to Move instead (fixed-6 is the core rule's 6").

#### end\_on\_terrain?

> `optional` **end\_on\_terrain?**: `true`

#### ends\_nearest?

> `optional` **ends\_nearest?**: [`EndsNearest2`](EndsNearest2.md)

#### ends\_when?

> `optional` **ends\_when?**: [`AbilityDSLCondition7`](../type-aliases/AbilityDSLCondition7.md)

#### ends\_when\_replaces?

> `optional` **ends\_when\_replaces?**: `true`

Only with ends_when: the ends_when condition replaces the usual end threshold ("instead of more than 8\"") rather than adding to it. Without this flag the condition adds to the usual rules.

#### mode\_choice?

> `optional` **mode\_choice?**: `object`

The unit can select a mode of its move (applies_to_moves) it otherwise could not: modes "any" is every mode of that move, a list names the modes. ignore_before_moving: the selection disregards the move's Before Moving restrictions ("regardless of that consolidation move's Before Moving restrictions").

##### mode\_choice.modes

> **modes**: `"any"` \| \[[`MoveMode`](../type-aliases/MoveMode.md), `...MoveMode[]`\]

##### mode\_choice.ignore\_before\_moving?

> `optional` **ignore\_before\_moving?**: `true`

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5448](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5448)
