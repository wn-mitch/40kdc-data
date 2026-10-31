[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceSpendEffect

# Interface: ResourceSpendEffect

Defined in: [generated.ts:6099](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6099)

[resource] Spend from a resource pool only when it has sufficient balance; the spend fails as a whole rather than producing a negative or clamped pool. face: spend dice showing this value; requirement: spend dice forming this pair, triple or run.

## Properties

### type

> **type**: `"resource-spend"`

Defined in: [generated.ts:6100](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6100)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:6101](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6101)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6102](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6102)

#### pool

> **pool**: `string`

#### amount

> **amount**: [`Quantity`](../type-aliases/Quantity.md)

#### label?

> `optional` **label?**: `string`

#### face?

> `optional` **face?**: `number`

#### requirement?

> `optional` **requirement?**: [`DiceRequirementSpec`](../type-aliases/DiceRequirementSpec.md)

#### amount\_table?

> `optional` **amount\_table?**: \[\{ `unit_ids`: \[`string`, `...string[]`\]; `starting_strength`: `number`; `amount`: `number`; \}, `...{ unit_ids: [string, ...string[]]; starting_strength: number; amount: number }[]`\]

With amount by-table: the amount for a unit of one of unit_ids at that Starting Strength (attached CHARACTER models not counted). table_of names the unit; a unit no row matches cannot pay.

##### Min Items

1

#### table\_of?

> `optional` **table\_of?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

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

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:6164](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6164)
