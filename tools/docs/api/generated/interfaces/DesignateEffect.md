[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DesignateEffect

# Interface: DesignateEffect

Defined in: [generated.ts:5134](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5134)

[designation] Tag a unit, objective or terrain area (or clear the tag).

## Properties

### type

> **type**: `"designate"`

Defined in: [generated.ts:5135](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5135)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5136](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5136)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5137](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5137)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](ObjectiveFilter.md); \} \| \{ `terrain_area`: \{\[`k`: `string`\]: `unknown`; \}; \}

#### tag

> **tag**: `string`

#### clear?

> `optional` **clear?**: `true`

#### by?

> `optional` **by?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

#### clears\_on?

> `optional` **clears\_on?**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5180](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5180)
