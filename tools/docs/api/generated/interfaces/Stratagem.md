[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Stratagem

# Interface: Stratagem

Defined in: [generated.ts:3403](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3403)

A CP-costed ability usable during specific game phases.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stratagem".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3404](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3404)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:3405](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3405)

***

### name

> **name**: `string`

Defined in: [generated.ts:3406](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3406)

***

### category

> **category**: `"core"` \| `"detachment"`

Defined in: [generated.ts:3410](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3410)

Whether this is a universal core stratagem or tied to a specific detachment

***

### type?

> `optional` **type?**: `"battle-tactic"` \| `"strategic-ploy"` \| `"epic-deed"` \| `"wargear"`

Defined in: [generated.ts:3414](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3414)

GW-printed stratagem category from the card. Optional: 11e faction packs omit it for newly introduced detachments, and the category has no in-game effect; absent when the source does not state one.

***

### detachment\_id?

> `optional` **detachment\_id?**: `string` \| `null`

Defined in: [generated.ts:3418](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3418)

Null for core stratagems

***

### cp\_cost

> **cp\_cost**: `number`

Defined in: [generated.ts:3419](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3419)

***

### phases

> **phases**: [`PhaseList`](../type-aliases/PhaseList.md)

Defined in: [generated.ts:3420](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3420)

***

### player\_turn

> **player\_turn**: [`PlayerTurn`](../type-aliases/PlayerTurn.md)

Defined in: [generated.ts:3421](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3421)

***

### timing

> **timing**: `"once-per-turn"` \| `"once-per-phase"` \| `"once-per-battle"` \| `"unlimited"`

Defined in: [generated.ts:3422](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3422)

***

### target\_restrictions?

> `optional` **target\_restrictions?**: \{ `required_keywords?`: [`KeywordList6`](../type-aliases/KeywordList6.md); `required_keywords_any?`: [`KeywordList7`](../type-aliases/KeywordList7.md); `excluded_keywords?`: [`KeywordList`](../type-aliases/KeywordList.md); `count?`: `"one"` \| `"one-or-more"` \| `"up-to"`; `count_max?`: `number`; `side?`: `"enemy"` \| `"your-army"`; `selects?`: `"unit"` \| `"model"`; `bound_to?`: `"triggering-unit"` \| `"attacked-unit"`; `eligibility?`: [`AbilityDSLCondition5`](../type-aliases/AbilityDSLCondition5.md); `notes?`: `string`; \} \| `null`

Defined in: [generated.ts:3423](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3423)

#### Union Members

##### Type Literal

\{ `required_keywords?`: [`KeywordList6`](../type-aliases/KeywordList6.md); `required_keywords_any?`: [`KeywordList7`](../type-aliases/KeywordList7.md); `excluded_keywords?`: [`KeywordList`](../type-aliases/KeywordList.md); `count?`: `"one"` \| `"one-or-more"` \| `"up-to"`; `count_max?`: `number`; `side?`: `"enemy"` \| `"your-army"`; `selects?`: `"unit"` \| `"model"`; `bound_to?`: `"triggering-unit"` \| `"attacked-unit"`; `eligibility?`: [`AbilityDSLCondition5`](../type-aliases/AbilityDSLCondition5.md); `notes?`: `string`; \}

##### required\_keywords?

> `optional` **required\_keywords?**: [`KeywordList6`](../type-aliases/KeywordList6.md)

##### required\_keywords\_any?

> `optional` **required\_keywords\_any?**: [`KeywordList7`](../type-aliases/KeywordList7.md)

##### excluded\_keywords?

> `optional` **excluded\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)

##### count?

> `optional` **count?**: `"one"` \| `"one-or-more"` \| `"up-to"`

How many targets are selected: one, one or more, or up to `count_max`.

##### count\_max?

> `optional` **count\_max?**: `number`

Upper bound when `count` is up-to.

##### side?

> `optional` **side?**: `"enemy"` \| `"your-army"`

Whose units can be selected.

##### selects?

> `optional` **selects?**: `"unit"` \| `"model"`

Whether the target is a unit or a single model.

##### bound\_to?

> `optional` **bound\_to?**: `"triggering-unit"` \| `"attacked-unit"`

The target is not freely chosen: it is the unit the WHEN moment names ("that unit"), or the unit the triggering enemy attacked.

##### eligibility?

> `optional` **eligibility?**: [`AbilityDSLCondition5`](../type-aliases/AbilityDSLCondition5.md)

##### notes?

> `optional` **notes?**: `string`

***

`null`

***

### ability\_id?

> `optional` **ability\_id?**: `string` \| `null`

Defined in: [generated.ts:3450](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3450)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3451](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3451)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes3`](../type-aliases/GameModes3.md)

Defined in: [generated.ts:3452](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3452)
