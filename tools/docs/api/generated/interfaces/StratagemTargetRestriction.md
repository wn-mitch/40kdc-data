[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StratagemTargetRestriction

# Interface: StratagemTargetRestriction

Defined in: [generated.ts:6066](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6066)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stratagem-target-restriction".

## Properties

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:6070](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6070)

Kebab-case identifier

***

### required\_keywords?

> `optional` **required\_keywords?**: [`KeywordList9`](../type-aliases/KeywordList9.md)

Defined in: [generated.ts:6071](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6071)

***

### required\_keywords\_any?

> `optional` **required\_keywords\_any?**: [`KeywordList10`](../type-aliases/KeywordList10.md)

Defined in: [generated.ts:6072](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6072)

***

### excluded\_keywords?

> `optional` **excluded\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:6073](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6073)

***

### count?

> `optional` **count?**: `"one-or-more"` \| `"one"` \| `"up-to"`

Defined in: [generated.ts:6077](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6077)

How many targets are selected: one, one or more, or up to `count_max`.

***

### count\_max?

> `optional` **count\_max?**: `number`

Defined in: [generated.ts:6081](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6081)

Upper bound when `count` is up-to (1: an optional extra target, zero or one unit).

***

### side?

> `optional` **side?**: `"enemy"` \| `"your-army"`

Defined in: [generated.ts:6085](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6085)

Whose units can be selected.

***

### selects?

> `optional` **selects?**: `"unit"` \| `"model"`

Defined in: [generated.ts:6089](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6089)

Whether the target is a unit or a single model.

***

### bound\_to?

> `optional` **bound\_to?**: `"triggering-unit"` \| `"attacked-unit"`

Defined in: [generated.ts:6093](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6093)

The target is not freely chosen: it is the unit the WHEN moment names ("that unit"), or the unit the triggering enemy attacked.

***

### eligibility?

> `optional` **eligibility?**: [`AbilityDSLCondition8`](../type-aliases/AbilityDSLCondition8.md)

Defined in: [generated.ts:6094](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6094)

***

### notes?

> `optional` **notes?**: `string`

Defined in: [generated.ts:6095](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6095)

***

### mode?

> `optional` **mode?**: `"a"` \| `"b"`

Defined in: [generated.ts:6099](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6099)

The exclusive target mode this target belongs to. Targets with the same mode are chosen together; a and b are alternatives. Set on every target when the Stratagem has modes (see target_restrictions).

***

### mode\_cost?

> `optional` **mode\_cost?**: `object`

Defined in: [generated.ts:6103](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6103)

What choosing this mode costs ("spend 2YP and target ... instead"). Every target of one mode carries the same mode_cost.

#### label

> **label**: `string`

The resource pool or resource the mode spends, as the resource-spend effect names it.

#### amount

> **amount**: `number`

How many of that resource the mode spends to be chosen.
