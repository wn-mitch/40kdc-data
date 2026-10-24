[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PermissionEffect

# Interface: PermissionEffect

Defined in: [generated.ts:4204](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4204)

[permission] Allow or forbid an activity. after: in a turn in which the unit made that move; despite: something that would normally block it (destroyed: a just-destroyed unit can still be targeted with a Stratagem); as_if: as if in that phase or using that shooting type; next: the unit must be the next one selected; reach: an extended distance.

## Properties

### type

> **type**: `"permission"`

Defined in: [generated.ts:4205](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4205)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4206](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4206)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4207](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4207)

#### activity

> **activity**: `"advance"` \| `"fall-back"` \| `"disembark"` \| `"embark"` \| `"fight"` \| `"shoot"` \| `"declare-charge"` \| `"start-action"` \| `"move"` \| `"observe"` \| `"use-stratagem"` \| `"issue-order"` \| `"attempt-ritual"` \| `"use-enhancement"`

#### allow

> **allow**: `boolean`

#### after?

> `optional` **after?**: \[`"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"disembark"` \| `"set-up"`, ...("normal" \| "advance" \| "remain-stationary" \| "fall-back" \| "charge" \| "disembark" \| "set-up")\[\]\]

##### Min Items

1

#### despite?

> `optional` **despite?**: \[`"destroyed"` \| `"engaged"` \| `"battle-shocked"` \| `"shot-this-phase"` \| `"fought-this-phase"` \| `"disembarked-this-turn"` \| `"stratagem-used-this-phase"` \| `"performing-action"` \| `"advanced"` \| `"fell-back"`, ...("destroyed" \| "engaged" \| "battle-shocked" \| "shot-this-phase" \| "fought-this-phase" \| "disembarked-this-turn" \| "stratagem-used-this-phase" \| "performing-action" \| "advanced" \| "fell-back")\[\]\]

##### Min Items

1

#### into?

> `optional` **into?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### as\_if?

> `optional` **as\_if?**: `"shooting-phase"` \| `"snap-shooting"` \| `"fight-phase"` \| `"movement-phase"` \| `"charge-phase"` \| `"command-phase"`

#### next?

> `optional` **next?**: `true`

#### reach?

> `optional` **reach?**: `number`

#### stratagem?

> `optional` **stratagem?**: `string`

#### counts\_as\_move?

> `optional` **counts\_as\_move?**: `"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"` \| `"embark"` \| `"pulse-jet"`

Doing so counts as having made this move this turn (a disembark counting as a Normal move).

#### consumes\_shared\_use?

> `optional` **consumes\_shared\_use?**: `false`

This use of the Stratagem does not count toward its once-per-phase limit for other units.

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4287](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4287)
