[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PermissionEffect

# Interface: PermissionEffect

Defined in: [generated.ts:4744](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4744)

[permission] Allow or forbid an activity. after: in a turn in which the unit made that move; despite: something that would normally block it (destroyed: a just-destroyed unit can still be targeted with a Stratagem); as_if: as if in that phase or using that shooting type; next: the unit must be the next one selected; reach: an extended distance.

## Properties

### type

> **type**: `"permission"`

Defined in: [generated.ts:4745](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4745)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4746](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4746)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4747](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4747)

#### activity

> **activity**: `"advance"` \| `"fall-back"` \| `"disembark"` \| `"embark"` \| `"fight"` \| `"shoot"` \| `"declare-charge"` \| `"start-action"` \| `"move"` \| `"observe"` \| `"use-stratagem"` \| `"issue-order"` \| `"attempt-ritual"` \| `"use-enhancement"`

#### allow

> **allow**: `boolean`

#### after?

> `optional` **after?**: \[`"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"disembark"` \| `"set-up"`, ...("normal" \| "advance" \| "remain-stationary" \| "fall-back" \| "charge" \| "disembark" \| "set-up")\[\]\]

##### Min Items

1

#### despite?

> `optional` **despite?**: \[`"destroyed"` \| `"engaged"` \| `"battle-shocked"` \| `"shot-this-phase"` \| `"fought-this-phase"` \| `"disembarked-this-turn"` \| `"stratagem-used-this-phase"` \| `"performing-action"` \| `"advanced"` \| `"fell-back"` \| `"transport-advanced"`, ...("destroyed" \| "engaged" \| "battle-shocked" \| "shot-this-phase" \| "fought-this-phase" \| "disembarked-this-turn" \| "stratagem-used-this-phase" \| "performing-action" \| "advanced" \| "fell-back" \| "transport-advanced")\[\]\]

##### Min Items

1

#### into?

> `optional` **into?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### as\_if?

> `optional` **as\_if?**: `"shooting-phase"` \| `"snap-shooting"` \| `"fight-phase"` \| `"movement-phase"` \| `"charge-phase"` \| `"command-phase"`

#### next?

> `optional` **next?**: `true`

#### reach?

> `optional` **reach?**: [`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

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

#### stratagem?

> `optional` **stratagem?**: `string`

#### counts\_as\_move?

> `optional` **counts\_as\_move?**: `"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"` \| `"embark"` \| `"pulse-jet"`

Doing so counts as having made this move this turn (a disembark counting as a Normal move).

#### counts\_as\_until?

> `optional` **counts\_as\_until?**: `"end-of-phase"`

The counts_as_move status holds only until the end of the phase the subject used the permission in ("counts as having made a Normal move that phase"); absent, it holds for the turn. Needs counts_as_move.

#### then\_cannot?

> `optional` **then\_cannot?**: \[`"advance"` \| `"fall-back"` \| `"disembark"` \| `"embark"` \| `"fight"` \| `"shoot"` \| `"declare-charge"` \| `"start-action"` \| `"move"` \| `"observe"` \| `"use-stratagem"` \| `"issue-order"` \| `"attempt-ritual"` \| `"use-enhancement"`, ...("advance" \| "fall-back" \| "disembark" \| "embark" \| "fight" \| "shoot" \| "declare-charge" \| "start-action" \| "move" \| "observe" \| "use-stratagem" \| "issue-order" \| "attempt-ritual" \| "use-enhancement")\[\]\]

If the subject uses this permission, it cannot do these activities for the rest of the turn ("if it does, it cannot declare a charge in the same turn"). Only with allow true.

##### Min Items

1

#### consumes\_shared\_use?

> `optional` **consumes\_shared\_use?**: `false`

This use of the Stratagem does not count toward its once-per-phase limit for other units.

#### weapons?

> `optional` **weapons?**: \[[`WeaponScope`](WeaponScope.md), `...WeaponScope[]`\]

A shoot permission that allows only these weapons: any one of them.

##### Min Items

1

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4888](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4888)
