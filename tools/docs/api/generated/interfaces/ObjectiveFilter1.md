[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ObjectiveFilter1

# Interface: ObjectiveFilter1

Defined in: [generated.ts:6200](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6200)

Which objectives. Every listed property must hold.

## Properties

### role?

> `optional` **role?**: `"central"` \| `"expansion"` \| `"home"` \| `"non-home"`

Defined in: [generated.ts:6201](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6201)

***

### home\_of?

> `optional` **home\_of?**: `"friendly"` \| `"enemy"`

Defined in: [generated.ts:6205](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6205)

The friendly or the enemy home objective.

***

### territory?

> `optional` **territory?**: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"` \| `"your-deployment-zone"` \| `"enemy-deployment-zone"`

Defined in: [generated.ts:6206](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6206)

***

### controlled\_by?

> `optional` **controlled\_by?**: [`Owner`](../type-aliases/Owner.md)

Defined in: [generated.ts:6207](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6207)

***

### designated?

> `optional` **designated?**: `string`

Defined in: [generated.ts:6208](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6208)

***

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:6212](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6212)

Kebab-case identifier

***

### selection\_var?

> `optional` **selection\_var?**: `string`

Defined in: [generated.ts:6216](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6216)

The objective marker a select-objective step bound.

***

### within?

> `optional` **within?**: `object`

Defined in: [generated.ts:6220](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6220)

Only objective markers within this range of `of` (default the model with the ability).

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

#### of?

> `optional` **of?**: [`PlaceRef`](../type-aliases/PlaceRef.md)

***

### controlled\_by\_unit?

> `optional` **controlled\_by\_unit?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:6227](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6227)

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

### clear\_of?

> `optional` **clear\_of?**: [`UnitFilter1`](UnitFilter1.md)

Defined in: [generated.ts:6256](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6256)
