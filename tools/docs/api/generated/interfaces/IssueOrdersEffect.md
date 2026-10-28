[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / IssueOrdersEffect

# Interface: IssueOrdersEffect

Defined in: [generated.ts:4160](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4160)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "issue-orders-effect".

## Properties

### type

> **type**: `"issue-orders"`

Defined in: [generated.ts:4161](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4161)

***

### count?

> `optional` **count?**: `number`

Defined in: [generated.ts:4162](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4162)

***

### range?

> `optional` **range?**: [`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md) \| \{ `per_battle_round`: \[[`NonTieredRangeRef`](../type-aliases/NonTieredRangeRef.md), `...NonTieredRangeRef[]`\]; \}

Defined in: [generated.ts:4166](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4166)

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

Defined in: [generated.ts:4174](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4174)

***

### issuer?

> `optional` **issuer?**: [`KeywordPredicate2`](KeywordPredicate2.md)

Defined in: [generated.ts:4175](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4175)

***

### ineligible\_states?

> `optional` **ineligible\_states?**: \[`"battle-shocked"`, `..."battle-shocked"[]`\]

Defined in: [generated.ts:4181](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4181)

Units in any of these states cannot be issued an Order.

#### Min Items

1

***

### ends\_on?

> `optional` **ends\_on?**: \[`"battle-shocked"`, `..."battle-shocked"[]`\]

Defined in: [generated.ts:4187](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4187)

An Order stops affecting a unit that enters any of these states.

#### Min Items

1

***

### one\_at\_a\_time?

> `optional` **one\_at\_a\_time?**: `true`

Defined in: [generated.ts:4191](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4191)

A unit is affected by at most one Order at a time; an Order issued to it later replaces the current one.

***

### benefit?

> `optional` **benefit?**: [`KeywordPredicate3`](KeywordPredicate3.md)

Defined in: [generated.ts:4192](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4192)

***

### options?

> `optional` **options?**: \[\{ `id?`: `string`; `name`: `string`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, `...{ id?: string; name: string; effect: EffectNode }[]`\]

Defined in: [generated.ts:4196](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4196)

#### Min Items

1

***

### menu\_from?

> `optional` **menu\_from?**: `string`

Defined in: [generated.ts:4217](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4217)

Kebab-case identifier

***

### only\_options?

> `optional` **only\_options?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:4223](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4223)

Only these Orders of the `menu_from` menu, by option id, can be issued.

#### Min Items

1
