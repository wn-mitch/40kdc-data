[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ObjectiveFilter1

# Interface: ObjectiveFilter1

Defined in: [generated.ts:5761](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5761)

Which objectives. Every listed property must hold.

## Properties

### role?

> `optional` **role?**: `"central"` \| `"expansion"` \| `"home"` \| `"non-home"`

Defined in: [generated.ts:5762](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5762)

***

### home\_of?

> `optional` **home\_of?**: `"friendly"` \| `"enemy"`

Defined in: [generated.ts:5766](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5766)

The friendly or the enemy home objective.

***

### territory?

> `optional` **territory?**: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"` \| `"your-deployment-zone"` \| `"enemy-deployment-zone"`

Defined in: [generated.ts:5767](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5767)

***

### controlled\_by?

> `optional` **controlled\_by?**: [`Owner`](../type-aliases/Owner.md)

Defined in: [generated.ts:5768](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5768)

***

### designated?

> `optional` **designated?**: `string`

Defined in: [generated.ts:5769](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5769)

***

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:5773](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5773)

Kebab-case identifier

***

### selection\_var?

> `optional` **selection\_var?**: `string`

Defined in: [generated.ts:5777](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5777)

The objective marker a select-objective step bound.

***

### within?

> `optional` **within?**: `object`

Defined in: [generated.ts:5781](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5781)

Only objective markers within this range of `of` (default the model with the ability).

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

#### of?

> `optional` **of?**: [`PlaceRef`](../type-aliases/PlaceRef.md)

***

### controlled\_by\_unit?

> `optional` **controlled\_by\_unit?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:5788](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5788)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### clear\_of?

> `optional` **clear\_of?**: [`UnitFilter1`](UnitFilter1.md)

Defined in: [generated.ts:5813](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5813)
