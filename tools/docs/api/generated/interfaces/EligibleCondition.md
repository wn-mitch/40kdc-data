[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EligibleCondition

# Interface: EligibleCondition

Defined in: [generated.ts:2066](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2066)

[state] The subject is eligible to do this. be-selected: eligible for `source_ability`'s selection.

## Properties

### type

> **type**: `"eligible"`

Defined in: [generated.ts:2067](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2067)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2068](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2068)

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

> `optional` **transport?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.
