[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ObjectiveFilter

# Interface: ObjectiveFilter

Defined in: [generated.ts:1525](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1525)

Which objectives. Every listed property must hold.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "objective-filter".

## Properties

### role?

> `optional` **role?**: `"central"` \| `"expansion"` \| `"home"` \| `"non-home"`

Defined in: [generated.ts:1526](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1526)

***

### home\_of?

> `optional` **home\_of?**: `"friendly"` \| `"enemy"`

Defined in: [generated.ts:1530](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1530)

The friendly or the enemy home objective.

***

### territory?

> `optional` **territory?**: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"` \| `"your-deployment-zone"` \| `"enemy-deployment-zone"`

Defined in: [generated.ts:1531](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1531)

***

### controlled\_by?

> `optional` **controlled\_by?**: [`Owner`](../type-aliases/Owner.md)

Defined in: [generated.ts:1532](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1532)

***

### designated?

> `optional` **designated?**: `string`

Defined in: [generated.ts:1533](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1533)

***

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:1537](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1537)

Kebab-case identifier

***

### selection\_var?

> `optional` **selection\_var?**: `string`

Defined in: [generated.ts:1541](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1541)

The objective marker a select-objective step bound.

***

### within?

> `optional` **within?**: `object`

Defined in: [generated.ts:1545](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1545)

Only objective markers within this range of `of` (default the model with the ability).

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

#### of?

> `optional` **of?**: [`PlaceRef`](../type-aliases/PlaceRef.md)

***

### controlled\_by\_unit?

> `optional` **controlled\_by\_unit?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:1552](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1552)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### clear\_of?

> `optional` **clear\_of?**: [`UnitFilter1`](UnitFilter1.md)

Defined in: [generated.ts:1577](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1577)
