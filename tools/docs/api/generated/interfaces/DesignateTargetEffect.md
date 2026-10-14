[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DesignateTargetEffect

# Interface: DesignateTargetEffect

Defined in: [generated.ts:3747](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3747)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "designate-target-effect".

## Properties

### type

> **type**: `"designate-target"`

Defined in: [generated.ts:3748](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3748)

***

### designation

> **designation**: `string`

Defined in: [generated.ts:3749](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3749)

***

### select

> **select**: `object`

Defined in: [generated.ts:3750](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3750)

#### kind

> **kind**: `"objective"` \| `"unit"`

#### selector

> **selector**: [`UnitSelector`](UnitSelector.md) \| [`ObjectiveSelector`](ObjectiveSelector.md)

***

### applies

> **applies**: `object`

Defined in: [generated.ts:3754](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3754)

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

Defined in: [generated.ts:3762](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3762)
