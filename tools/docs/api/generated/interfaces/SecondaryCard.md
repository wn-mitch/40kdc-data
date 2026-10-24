[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / SecondaryCard

# Interface: SecondaryCard

Defined in: [generated.ts:2973](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2973)

An 11e mission card. The deck-level rule (draw 2 per turn, keep unscored cards) is separate and not modelled here. This is the per-card shape: an optional on-draw deck operation, an optional player action, and zero or more VP-award blocks. Primary mission cards reuse this shape via card_type. Mechanic blocks reference the Ability DSL; prose is community-authored (no reproduced rules text).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "secondary-card".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:2974](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2974)

***

### name

> **name**: `string`

Defined in: [generated.ts:2975](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2975)

***

### card\_type?

> `optional` **card\_type?**: `"secondary"` \| `"primary"`

Defined in: [generated.ts:2979](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2979)

Whether this is a secondary card or a primary mission card (which reuses this shape).

***

### subtype?

> `optional` **subtype?**: `string`

Defined in: [generated.ts:2983](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2983)

Finer classification within the deck (e.g. a category or tactical/fixed split). Free-form — not enum-locked until 11e categories are confirmed.

***

### when\_drawn?

> `optional` **when\_drawn?**: `object`

Defined in: [generated.ts:2987](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2987)

Optional deck operation performed when this card is drawn (e.g. redraw, swap). Distinct from combat effects — deck operations have no combat target, so they are not modelled via the Ability DSL effect language. If `condition` is present, the operation fires only when the predicate holds.

#### operation

> **operation**: `"reshuffle"` \| `"replace"` \| `"redraw"` \| `"draw-extra"` \| `"swap"`

The deck manipulation this card triggers on draw.

#### card\_ids?

> `optional` **card\_ids?**: `string`[]

Other cards this operation references, by id.

#### condition?

> `optional` **condition?**: [`ArmyCompositionPredicate1`](ArmyCompositionPredicate1.md)

#### battle\_round?

> `optional` **battle\_round?**: `object`

Battle-round window in which the draw operation is eligible (e.g. { max: 1 } means 'only when drawn in the first battle round'). Absent means the operation fires regardless of round.

##### battle\_round.min?

> `optional` **min?**: `number`

##### battle\_round.max?

> `optional` **max?**: `number`

***

### actions?

> `optional` **actions?**: \[\{ `action_id?`: `string`; `starts?`: `"charge"` \| `"command"` \| `"movement"` \| `"shooting"` \| `"fight"`; `timing?`: `"start-of-turn"` \| `"end-of-turn"` \| `"start-of-battle"`; `battle_round?`: \{ `min?`: `number`; `max?`: `number`; \}; `player_turn?`: [`PlayerTurn`](../type-aliases/PlayerTurn.md); `units?`: [`AbilityDSLCondition2`](../type-aliases/AbilityDSLCondition2.md); `use_limit?`: `number`; `use_limit_scope?`: `"per-turn"` \| `"per-game"`; `completes?`: [`AbilityDSLCondition3`](../type-aliases/AbilityDSLCondition3.md); `effect?`: [`AbilityEffect`](../type-aliases/AbilityEffect.md); `restrictions?`: [`AbilityDSLCondition7`](../type-aliases/AbilityDSLCondition7.md); \}, ...\{ action\_id?: string; starts?: "charge" \| "command" \| "movement" \| "shooting" \| "fight"; timing?: "start-of-turn" \| "end-of-turn" \| "start-of-battle"; battle\_round?: \{ min?: number; max?: number \}; player\_turn?: PlayerTurn; units?: AbilityDSLCondition2; use\_limit?: number; use\_limit\_scope?: "per-turn" \| "per-game"; completes?: AbilityDSLCondition3; effect?: AbilityEffect; restrictions?: AbilityDSLCondition7 \}\[\]\]

Defined in: [generated.ts:3010](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3010)

Optional player actions the card enables. Most cards have a single action; a few (e.g. Observe Enemy, with separate Baited-removal and Spotted actions) have two distinct actions on the same card.

#### Min Items

1

***

### awards?

> `optional` **awards?**: \[\{\[`k`: `string`\]: `unknown`; \} \| \{\[`k`: `string`\]: `unknown`; \}, ...(\{ \[k: string\]: unknown \} \| \{ \[k: string\]: unknown \})\[\]\]

Defined in: [generated.ts:3085](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3085)

VP-award blocks: each scores when `trigger` fires and the optional `when` condition holds. An award scores either a flat `vp` or a count-scaled `vp_per` (VP per instance of the thing named by `per`). Awards accrue independently and sum; a card's '+ ... CUMULATIVE' rows are modelled as separate awards flagged `cumulative` for faithful round-trip. Awards sharing the same `exclusive_group` value within a card resolve as the highest-scoring single award fires (the card's literal 'OR' rows between tier breakpoints, e.g. Record-Breaking Mission's 3-Fronts vs 4-Fronts).

#### Min Items

1

***

### text?

> `optional` **text?**: `string`

Defined in: [generated.ts:3106](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3106)

Community-authored card description (original prose only — no reproduced rules text).

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3107](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3107)
