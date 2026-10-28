[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StratagemTargetRestriction

# Interface: StratagemTargetRestriction

Defined in: [generated.ts:6735](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6735)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stratagem-target-restriction".

## Properties

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:6739](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6739)

Kebab-case identifier

***

### required\_keywords?

> `optional` **required\_keywords?**: [`KeywordList9`](../type-aliases/KeywordList9.md)

Defined in: [generated.ts:6740](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6740)

***

### required\_keywords\_any?

> `optional` **required\_keywords\_any?**: [`KeywordList10`](../type-aliases/KeywordList10.md)

Defined in: [generated.ts:6741](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6741)

***

### excluded\_keywords?

> `optional` **excluded\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:6742](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6742)

***

### warlord?

> `optional` **warlord?**: `true`

Defined in: [generated.ts:6746](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6746)

The target is your Warlord: the Warlord model when `selects` is model, the unit that contains it when `selects` is unit. Warlord is the model chosen at mustering, not a keyword, so it never appears in the keyword lists; those still apply to the Warlord ("your DEATH GUARD WARLORD" is warlord plus required_keywords DEATH GUARD). Absent when the target need not be the Warlord. An enemy target is never your Warlord (integrity rejects warlord with side enemy).

***

### count?

> `optional` **count?**: `"one-or-more"` \| `"one"` \| `"up-to"`

Defined in: [generated.ts:6750](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6750)

How many targets are selected: one, one or more, or up to `count_max`.

***

### count\_max?

> `optional` **count\_max?**: `number`

Defined in: [generated.ts:6754](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6754)

Upper bound when `count` is up-to (1: an optional extra target, zero or one unit).

***

### side?

> `optional` **side?**: `"enemy"` \| `"your-army"`

Defined in: [generated.ts:6758](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6758)

Whose units can be selected.

***

### selects?

> `optional` **selects?**: `"unit"` \| `"model"`

Defined in: [generated.ts:6762](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6762)

Whether the target is a unit or a single model.

***

### bound\_to?

> `optional` **bound\_to?**: `"triggering-unit"` \| `"attacked-unit"`

Defined in: [generated.ts:6766](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6766)

The target is not freely chosen: it is the unit the WHEN moment names ("that unit"), or the unit the triggering enemy attacked.

***

### eligibility?

> `optional` **eligibility?**: [`AbilityDSLCondition9`](../type-aliases/AbilityDSLCondition9.md)

Defined in: [generated.ts:6767](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6767)

***

### notes?

> `optional` **notes?**: `string`

Defined in: [generated.ts:6768](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6768)

***

### mode?

> `optional` **mode?**: `"a"` \| `"b"`

Defined in: [generated.ts:6772](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6772)

The exclusive target mode this target belongs to. Targets with the same mode are chosen together; a and b are alternatives. Set on every target when the Stratagem has modes (see target_restrictions).

***

### mode\_cost?

> `optional` **mode\_cost?**: `object`

Defined in: [generated.ts:6776](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6776)

What choosing this mode costs ("spend 2YP and target ... instead"). Every target of one mode carries the same mode_cost.

#### label

> **label**: `string`

The resource pool or resource the mode spends, as the resource-spend effect names it.

#### amount

> **amount**: `number`

How many of that resource the mode spends to be chosen.
