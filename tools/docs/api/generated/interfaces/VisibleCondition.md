[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / VisibleCondition

# Interface: VisibleCondition

Defined in: [generated.ts:2120](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2120)

[visibility] The subject is visible (fully visible, if set) to `to` (default the attacker). With blocked_by, the view is instead blocked by that unit.

## Properties

### type

> **type**: `"visible"`

Defined in: [generated.ts:2121](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2121)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2122](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2122)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### to?

> `optional` **to?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### fully?

> `optional` **fully?**: `true`

#### blocked\_by?

> `optional` **blocked\_by?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \}

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.
