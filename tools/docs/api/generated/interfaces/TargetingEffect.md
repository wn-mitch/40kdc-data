[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TargetingEffect

# Interface: TargetingEffect

Defined in: [generated.ts:5208](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5208)

[permission] Who may, may not or must target whom, under which limit.

## Properties

### type

> **type**: `"targeting"`

Defined in: [generated.ts:5209](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5209)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5210](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5210)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5211](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5211)

#### by?

> `optional` **by?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### may

> **may**: `"target"` \| `"cannot-target"` \| `"must-target"` \| `"redirect"`

#### target?

> `optional` **target?**: [`UnitRef`](../type-aliases/UnitRef.md) \| `"every-eligible"`

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### kind?

> `optional` **kind?**: `"charge"` \| `"fight"` \| `"ability"` \| `"stratagem"` \| `"shoot"` \| `"attack"`

#### stratagem?

> `optional` **stratagem?**: `string`

#### ability?

> `optional` **ability?**: `string`

Kebab-case identifier

#### only\_if\_none?

> `optional` **only\_if\_none?**: [`UnitFilter`](UnitFilter.md)

#### to?

> `optional` **to?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

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

#### if\_eligible?

> `optional` **if\_eligible?**: `true`

redirect: only if `to` is an eligible target.

#### except?

> `optional` **except?**: `"core-stratagems"`

cannot-target with Stratagems: Core Stratagems can still target it.

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

#### target\_condition?

> `optional` **target\_condition?**: [`AbilityDSLCondition5`](../type-aliases/AbilityDSLCondition5.md)

#### not\_engaged\_with?

> `optional` **not\_engaged\_with?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

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

Defined in: [generated.ts:5298](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5298)
