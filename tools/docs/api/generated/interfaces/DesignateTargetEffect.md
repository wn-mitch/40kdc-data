[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DesignateTargetEffect

# Interface: DesignateTargetEffect

Defined in: [generated.ts:4280](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4280)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "designate-target-effect".

## Properties

### type

> **type**: `"designate-target"`

Defined in: [generated.ts:4281](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4281)

***

### designation

> **designation**: `string`

Defined in: [generated.ts:4282](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4282)

***

### select

> **select**: `object`

Defined in: [generated.ts:4283](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4283)

#### kind

> **kind**: `"objective"` \| `"unit"`

#### selector

> **selector**: [`UnitSelector`](UnitSelector.md) \| [`ObjectiveSelector`](ObjectiveSelector.md)

***

### applies

> **applies**: [`DesignationApplies`](DesignationApplies.md) \| \[[`DesignationApplies`](DesignationApplies.md) & `object`, [`DesignationApplies`](DesignationApplies.md) & `object`\] \| \[[`DesignationApplies`](DesignationApplies.md) & `object`, [`DesignationApplies`](DesignationApplies.md) & `object`, [`DesignationApplies`](DesignationApplies.md) & `object`\]

Defined in: [generated.ts:4290](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4290)

What the designation does: one entry, or one entry per `to` when it does more than one thing to the designated unit ("that enemy unit cannot have the Benefit of Cover, and each time a friendly unit makes an attack that targets that unit, …"). Each entry of a list names a different `to`; a list never holds bound-unit-attacks-reference.

***

### duration?

> `optional` **duration?**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

Defined in: [generated.ts:4316](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4316)
