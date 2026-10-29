[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PersistentDesignationEffect

# Interface: PersistentDesignationEffect

Defined in: [generated.ts:4573](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4573)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "persistent-designation-effect".

## Properties

### type

> **type**: `"persistent-designation"`

Defined in: [generated.ts:4574](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4574)

***

### operation?

> `optional` **operation?**: `"replace"` \| `"establish"`

Defined in: [generated.ts:4575](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4575)

***

### designation

> **designation**: `string`

Defined in: [generated.ts:4576](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4576)

***

### select

> **select**: `object`

Defined in: [generated.ts:4577](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4577)

#### kind

> **kind**: `"objective"` \| `"unit"`

#### selector

> **selector**: [`UnitSelector`](UnitSelector.md) \| [`ObjectiveSelector`](ObjectiveSelector.md)

***

### consumer?

> `optional` **consumer?**: `object`

Defined in: [generated.ts:4581](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4581)

#### relation

> **relation**: `"attacks-selected-unit"` \| `"within-selected-marker"`

#### beneficiary

> **beneficiary**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

#### reference?

> `optional` **reference?**: [`SelectionReference`](SelectionReference.md)

#### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

***

### duration

> **duration**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

Defined in: [generated.ts:4614](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4614)

***

### lifecycle?

> `optional` **lifecycle?**: `object`

Defined in: [generated.ts:4615](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4615)

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

Defined in: [generated.ts:4623](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4623)

***

### allow\_while\_embarked?

> `optional` **allow\_while\_embarked?**: `boolean`

Defined in: [generated.ts:4624](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4624)
