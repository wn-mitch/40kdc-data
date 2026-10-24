[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PersistentDesignationEffect

# Interface: PersistentDesignationEffect

Defined in: [generated.ts:4065](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4065)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "persistent-designation-effect".

## Properties

### type

> **type**: `"persistent-designation"`

Defined in: [generated.ts:4066](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4066)

***

### operation?

> `optional` **operation?**: `"replace"` \| `"establish"`

Defined in: [generated.ts:4067](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4067)

***

### designation

> **designation**: `string`

Defined in: [generated.ts:4068](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4068)

***

### select

> **select**: `object`

Defined in: [generated.ts:4069](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4069)

#### kind

> **kind**: `"objective"` \| `"unit"`

#### selector

> **selector**: [`UnitSelector`](UnitSelector.md) \| [`ObjectiveSelector`](ObjectiveSelector.md)

***

### consumer?

> `optional` **consumer?**: `object`

Defined in: [generated.ts:4073](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4073)

#### relation

> **relation**: `"attacks-selected-unit"` \| `"within-selected-marker"`

#### beneficiary

> **beneficiary**: `"this-unit"` \| `"this-model"`

#### reference?

> `optional` **reference?**: [`SelectionReference`](SelectionReference.md)

#### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

***

### duration

> **duration**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

Defined in: [generated.ts:4079](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4079)

***

### lifecycle?

> `optional` **lifecycle?**: `object`

Defined in: [generated.ts:4080](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4080)

#### replace

> **replace**: `object`

##### replace.event

> **event**: `"on-unit-destroyed"`

##### replace.reference

> **reference**: [`UnitRef`](../type-aliases/UnitRef.md)

##### replace.optional

> **optional**: `boolean`

#### exclusivity

> **exclusivity**: `"one-active-per-bearer-unit"`

***

### selection\_policy

> **selection\_policy**: `"one-time"` \| `"replace-on-destroyed"`

Defined in: [generated.ts:4088](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4088)

***

### allow\_while\_embarked?

> `optional` **allow\_while\_embarked?**: `boolean`

Defined in: [generated.ts:4089](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4089)
