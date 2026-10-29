[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ArmyCompositionPredicate

# Interface: ArmyCompositionPredicate

Defined in: [generated.ts:3327](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3327)

A draw-time predicate over an army list (not runtime board state, so deliberately NOT the Ability DSL condition). Used to gate when_drawn operations such as redraws. Example: a card that is void unless the opponent fields a large unit (10e 'Cull the Horde' redrew when the opponent had no unit of 14+ models) is { subject: 'opponent', quantifier: 'none', unit_filter: { model_count_min: 14 } } with operation 'redraw'.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "army-composition-predicate".

## Properties

### subject

> **subject**: `"self"` \| `"opponent"`

Defined in: [generated.ts:3331](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3331)

Whose army list the predicate inspects.

***

### quantifier

> **quantifier**: `"any"` \| `"none"`

Defined in: [generated.ts:3335](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3335)

Whether the army must contain ('any') or lack ('none') a unit matching unit_filter for the predicate to hold.

***

### unit\_filter

> **unit\_filter**: `object`

Defined in: [generated.ts:3339](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3339)

Criteria a unit in the army must satisfy to match. All present criteria must hold (logical AND).

#### model\_count\_min?

> `optional` **model\_count\_min?**: `number`

#### model\_count\_max?

> `optional` **model\_count\_max?**: `number`

#### wounds\_min?

> `optional` **wounds\_min?**: `number`

#### keywords?

> `optional` **keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)
