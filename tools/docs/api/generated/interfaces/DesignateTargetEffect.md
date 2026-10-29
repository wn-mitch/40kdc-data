[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DesignateTargetEffect

# Interface: DesignateTargetEffect

Defined in: [generated.ts:4120](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4120)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "designate-target-effect".

## Properties

### type

> **type**: `"designate-target"`

Defined in: [generated.ts:4121](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4121)

***

### designation

> **designation**: `string`

Defined in: [generated.ts:4122](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4122)

***

### select

> **select**: `object`

Defined in: [generated.ts:4123](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4123)

#### kind

> **kind**: `"objective"` \| `"unit"`

#### selector

> **selector**: [`UnitSelector`](UnitSelector.md) \| [`ObjectiveSelector`](ObjectiveSelector.md)

***

### applies

> **applies**: `object`

Defined in: [generated.ts:4127](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4127)

#### to

> **to**: `"target"` \| `"attackers-of-target"` \| `"bearer-attacks-target"` \| `"bound-unit-attacks-reference"`

#### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

#### attacker\_filter?

> `optional` **attacker\_filter?**: [`UnitFilter`](UnitFilter.md)

#### attacker\_unit\_filter?

> `optional` **attacker\_unit\_filter?**: [`UnitFilter`](UnitFilter.md)

#### beneficiary?

> `optional` **beneficiary?**: [`EventOrSelectionReference`](../type-aliases/EventOrSelectionReference.md)

#### reference?

> `optional` **reference?**: [`SelectionReference`](SelectionReference.md)

***

### duration?

> `optional` **duration?**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

Defined in: [generated.ts:4135](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4135)
