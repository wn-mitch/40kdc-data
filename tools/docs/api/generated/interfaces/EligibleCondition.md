[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EligibleCondition

# Interface: EligibleCondition

Defined in: [generated.ts:2162](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2162)

[state] The subject is eligible to do this. be-selected: eligible for `source_ability`'s selection.

## Properties

### type

> **type**: `"eligible"`

Defined in: [generated.ts:2163](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2163)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2164](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2164)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### to

> **to**: `"fight"` \| `"shoot"` \| `"declare-charge"` \| `"start-action"` \| `"be-selected"` \| `"embark-within"`

#### source\_ability?

> `optional` **source\_ability?**: `object`

##### source\_ability.ability\_id

> **ability\_id**: `string`

##### source\_ability.owner?

> `optional` **owner?**: `"friendly"` \| `"enemy"` \| `"any"`

A definite player: friendly or enemy (an owner other than any).

#### at?

> `optional` **at?**: `"now"` \| `"phase-start"` \| `"turn-start"` \| `"opponent-previous-turn-end"`

#### transport?

> `optional` **transport?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

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
