[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitRef

# Type Alias: UnitRef

> **UnitRef** = `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| [`UnitFilter`](../interfaces/UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \}

Defined in: [generated.ts:214](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L214)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit-ref".
