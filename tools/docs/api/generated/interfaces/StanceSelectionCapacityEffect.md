[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StanceSelectionCapacityEffect

# Interface: StanceSelectionCapacityEffect

Defined in: [generated.ts:3950](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3950)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stance-selection-capacity-effect".

## Properties

### type

> **type**: `"stance-selection-capacity"`

Defined in: [generated.ts:3951](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3951)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3952](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3952)

#### option?

> `optional` **option?**: `object`

##### option.ability\_id

> **ability\_id**: `string`

##### option.option\_id

> **option\_id**: `string`

#### options?

> `optional` **options?**: \[\{ `ability_id`: `string`; `option_id`: `string`; \}, `...{ ability_id: string; option_id: string }[]`\]

##### Min Items

1

#### additional\_selections

> **additional\_selections**: `number`

#### allocation

> **allocation**: `"choose-one-option"` \| `"fixed-option"`

#### ability\_id

> **ability\_id**: `string`
