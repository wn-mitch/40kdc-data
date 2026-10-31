[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RollEffect

# Interface: RollEffect

Defined in: [generated.ts:4872](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4872)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "roll-effect".

## Properties

### type

> **type**: `"roll"`

Defined in: [generated.ts:4873](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4873)

***

### dice

> **dice**: `string`

Defined in: [generated.ts:4874](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4874)

***

### count\_stat?

> `optional` **count\_stat?**: `object`

Defined in: [generated.ts:4878](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4878)

Roll as many of `dice` (one die, such as D6) as this characteristic of `of` (as many D6 as the selected model's Toughness).

#### stat

> **stat**: `"M"` \| `"T"` \| `"W"` \| `"OC"` \| `"A"`

#### of

> **of**: [`UnitRef`](../type-aliases/UnitRef.md)

***

### extra\_dice\_pool?

> `optional` **extra\_dice\_pool?**: `string`

Defined in: [generated.ts:4899](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4899)

***

### kind?

> `optional` **kind?**: [`RollKind`](../type-aliases/RollKind.md)

Defined in: [generated.ts:4900](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4900)

***

### roll\_var

> **roll\_var**: `string`

Defined in: [generated.ts:4901](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4901)

***

### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:4902](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4902)
