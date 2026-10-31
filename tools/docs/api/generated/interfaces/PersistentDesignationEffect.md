[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PersistentDesignationEffect

# Interface: PersistentDesignationEffect

Defined in: [generated.ts:4802](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4802)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "persistent-designation-effect".

## Properties

### type

> **type**: `"persistent-designation"`

Defined in: [generated.ts:4803](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4803)

***

### operation?

> `optional` **operation?**: `"replace"` \| `"establish"`

Defined in: [generated.ts:4804](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4804)

***

### designation

> **designation**: `string`

Defined in: [generated.ts:4805](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4805)

***

### select

> **select**: `object`

Defined in: [generated.ts:4806](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4806)

#### kind

> **kind**: `"objective"` \| `"unit"`

#### selector

> **selector**: [`UnitSelector`](UnitSelector.md) \| [`ObjectiveSelector`](ObjectiveSelector.md)

***

### consumer?

> `optional` **consumer?**: `object`

Defined in: [generated.ts:4810](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4810)

#### relation

> **relation**: `"attacks-selected-unit"` \| `"within-selected-marker"`

#### beneficiary

> **beneficiary**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

##### Union Members

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

###### Type Literal

\{ `event_var`: `string`; `role?`: `"object"`; \}

###### event\_var

> **event\_var**: `string`

###### role?

> `optional` **role?**: `"object"`

The bound event's object (the unit it was aimed at) instead of its actor.

***

###### Type Literal

\{ `selection_var`: `string`; \}

***

###### Type Literal

\{ `stratagem_target`: `string`; \}

#### reference?

> `optional` **reference?**: [`SelectionReference`](SelectionReference.md)

#### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

***

### duration

> **duration**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

Defined in: [generated.ts:4847](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4847)

***

### lifecycle?

> `optional` **lifecycle?**: `object`

Defined in: [generated.ts:4848](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4848)

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

Defined in: [generated.ts:4856](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4856)

***

### allow\_while\_embarked?

> `optional` **allow\_while\_embarked?**: `boolean`

Defined in: [generated.ts:4857](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4857)
