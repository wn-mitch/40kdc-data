[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / IssueOrdersEffect

# Interface: IssueOrdersEffect

Defined in: [generated.ts:4353](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4353)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "issue-orders-effect".

## Properties

### type

> **type**: `"issue-orders"`

Defined in: [generated.ts:4354](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4354)

***

### count?

> `optional` **count?**: `number`

Defined in: [generated.ts:4355](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4355)

***

### range?

> `optional` **range?**: [`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

Defined in: [generated.ts:4359](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4359)

One reference for every distance. A per_battle_round table is indexed from battle round 1; each later round uses the next entry and the final entry continues for all subsequent rounds. Tier entries are non-tiered range refs, so nested tables are forbidden.

#### Union Members

[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md)

***

##### Type Literal

\{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

##### per\_battle\_round

> **per\_battle\_round**: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]

###### Min Items

1

***

### eligible?

> `optional` **eligible?**: [`KeywordPredicate1`](KeywordPredicate1.md)

Defined in: [generated.ts:4367](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4367)

***

### recipient?

> `optional` **recipient?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:4371](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4371)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

#### Union Members

`"this-unit"`

***

`"this-model"`

***

`"model-in-this-unit"`

***

`"attacker"`

***

`"defender"`

***

`"event-subject"`

***

`"event-object"`

***

`"stratagem-target"`

***

`"selected-unit"`

***

`"recipient"`

***

`"bearer-transport"`

***

`"ability-unit"`

***

[`UnitFilter`](UnitFilter.md)

***

##### Type Literal

\{ `event_var`: `string`; `role?`: `"object"`; \}

##### event\_var

> **event\_var**: `string`

##### role?

> `optional` **role?**: `"object"`

The bound event's object (the unit it was aimed at) instead of its actor.

***

##### Type Literal

\{ `selection_var`: `string`; \}

***

##### Type Literal

\{ `stratagem_target`: `string`; \}

***

### counts\_toward\_limit?

> `optional` **counts\_toward\_limit?**: `false`

Defined in: [generated.ts:4403](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4403)

The Order does not count toward the Orders the officer can issue this turn.

***

### issuer?

> `optional` **issuer?**: [`KeywordPredicate2`](KeywordPredicate2.md)

Defined in: [generated.ts:4404](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4404)

***

### ineligible\_states?

> `optional` **ineligible\_states?**: \[`"battle-shocked"`, `..."battle-shocked"[]`\]

Defined in: [generated.ts:4410](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4410)

Units in any of these states cannot be issued an Order.

#### Min Items

1

***

### ends\_on?

> `optional` **ends\_on?**: \[`"battle-shocked"`, `..."battle-shocked"[]`\]

Defined in: [generated.ts:4416](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4416)

An Order stops affecting a unit that enters any of these states.

#### Min Items

1

***

### one\_at\_a\_time?

> `optional` **one\_at\_a\_time?**: `true`

Defined in: [generated.ts:4420](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4420)

A unit is affected by at most one Order at a time; an Order issued to it later replaces the current one.

***

### benefit?

> `optional` **benefit?**: [`KeywordPredicate3`](KeywordPredicate3.md)

Defined in: [generated.ts:4421](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4421)

***

### options?

> `optional` **options?**: \[\{ `id?`: `string`; `name`: `string`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, `...{ id?: string; name: string; effect: EffectNode }[]`\]

Defined in: [generated.ts:4425](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4425)

#### Min Items

1

***

### menu\_from?

> `optional` **menu\_from?**: `string`

Defined in: [generated.ts:4446](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4446)

Kebab-case identifier

***

### only\_options?

> `optional` **only\_options?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:4452](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4452)

Only these Orders of the `menu_from` menu, by option id, can be issued.

#### Min Items

1
