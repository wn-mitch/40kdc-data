[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StratagemTargetRestriction

# Interface: StratagemTargetRestriction

Defined in: [generated.ts:7275](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7275)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stratagem-target-restriction".

## Properties

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:7279](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7279)

Kebab-case identifier

***

### required\_keywords?

> `optional` **required\_keywords?**: [`KeywordList11`](../type-aliases/KeywordList11.md)

Defined in: [generated.ts:7280](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7280)

***

### required\_keywords\_any?

> `optional` **required\_keywords\_any?**: [`KeywordList12`](../type-aliases/KeywordList12.md)

Defined in: [generated.ts:7281](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7281)

***

### excluded\_keywords?

> `optional` **excluded\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:7282](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7282)

***

### warlord?

> `optional` **warlord?**: `true`

Defined in: [generated.ts:7286](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7286)

The target is your Warlord: the Warlord model when `selects` is model, the unit that contains it when `selects` is unit. Warlord is the model chosen at mustering, not a keyword, so it never appears in the keyword lists; those still apply to the Warlord ("your DEATH GUARD WARLORD" is warlord plus required_keywords DEATH GUARD). Absent when the target need not be the Warlord. An enemy target is never your Warlord (integrity rejects warlord with side enemy).

***

### count?

> `optional` **count?**: `"one-or-more"` \| `"one"` \| `"up-to"`

Defined in: [generated.ts:7290](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7290)

How many targets are selected: one, one or more, or up to `count_max`.

***

### count\_max?

> `optional` **count\_max?**: `number`

Defined in: [generated.ts:7294](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7294)

Upper bound when `count` is up-to (1: an optional extra target, zero or one unit).

***

### side?

> `optional` **side?**: `"enemy"` \| `"your-army"`

Defined in: [generated.ts:7298](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7298)

Whose units can be selected.

***

### selects?

> `optional` **selects?**: `"unit"` \| `"model"`

Defined in: [generated.ts:7302](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7302)

Whether the target is a unit or a single model.

***

### bound\_to?

> `optional` **bound\_to?**: `"triggering-unit"` \| `"attacked-unit"`

Defined in: [generated.ts:7306](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7306)

The target is not freely chosen: it is the unit the WHEN moment names ("that unit"), or the unit the triggering enemy attacked.

***

### eligibility?

> `optional` **eligibility?**: [`AbilityDSLCondition9`](../type-aliases/AbilityDSLCondition9.md)

Defined in: [generated.ts:7307](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7307)

***

### notes?

> `optional` **notes?**: `string`

Defined in: [generated.ts:7308](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7308)

***

### mode?

> `optional` **mode?**: `"a"` \| `"b"`

Defined in: [generated.ts:7312](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7312)

The exclusive target mode this target belongs to. Targets with the same mode are chosen together; a and b are alternatives. Set on every target when the Stratagem has modes (see target_restrictions).

***

### mode\_cost?

> `optional` **mode\_cost?**: `object`

Defined in: [generated.ts:7316](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7316)

What choosing this mode costs ("spend 2YP and target ... instead"). Every target of one mode carries the same mode_cost.

#### label

> **label**: `string`

The resource pool or resource the mode spends, as the resource-spend effect names it.

#### amount

> **amount**: `number`

How many of that resource the mode spends to be chosen.
