[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EligibleCondition

# Interface: EligibleCondition

Defined in: [generated.ts:1766](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1766)

[state] The subject is eligible to do this. be-selected: eligible for `source_ability`'s selection.

## Properties

### type

> **type**: `"eligible"`

Defined in: [generated.ts:1767](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1767)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1768](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1768)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### to

> **to**: `"fight"` \| `"shoot"` \| `"declare-charge"` \| `"start-action"` \| `"be-selected"` \| `"embark-within"`

#### source\_ability?

> `optional` **source\_ability?**: `object`

##### source\_ability.ability\_id

> **ability\_id**: `string`

##### source\_ability.owner?

> `optional` **owner?**: `"friendly"` \| `"enemy"`

#### at?

> `optional` **at?**: `"now"` \| `"opponent-previous-turn-end"`

#### transport?

> `optional` **transport?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.
