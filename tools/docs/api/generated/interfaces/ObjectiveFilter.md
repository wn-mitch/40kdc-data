[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ObjectiveFilter

# Interface: ObjectiveFilter

Defined in: [generated.ts:1585](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1585)

Which objectives. Every listed property must hold.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "objective-filter".

## Properties

### role?

> `optional` **role?**: `"central"` \| `"expansion"` \| `"home"` \| `"non-home"`

Defined in: [generated.ts:1586](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1586)

***

### home\_of?

> `optional` **home\_of?**: `"friendly"` \| `"enemy"`

Defined in: [generated.ts:1590](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1590)

The friendly or the enemy home objective.

***

### territory?

> `optional` **territory?**: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"` \| `"your-deployment-zone"` \| `"enemy-deployment-zone"`

Defined in: [generated.ts:1591](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1591)

***

### controlled\_by?

> `optional` **controlled\_by?**: [`Owner`](../type-aliases/Owner.md)

Defined in: [generated.ts:1592](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1592)

***

### designated?

> `optional` **designated?**: `string`

Defined in: [generated.ts:1593](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1593)

***

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:1597](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1597)

Kebab-case identifier

***

### selection\_var?

> `optional` **selection\_var?**: `string`

Defined in: [generated.ts:1601](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1601)

The objective marker a select-objective step bound.

***

### within?

> `optional` **within?**: `object`

Defined in: [generated.ts:1605](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1605)

Only objective markers within this range of `of` (default the model with the ability).

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

#### of?

> `optional` **of?**: [`PlaceRef`](../type-aliases/PlaceRef.md)

***

### controlled\_by\_unit?

> `optional` **controlled\_by\_unit?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:1612](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1612)

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

Defined in: [generated.ts:1641](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1641)
