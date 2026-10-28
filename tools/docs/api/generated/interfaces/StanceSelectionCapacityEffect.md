[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StanceSelectionCapacityEffect

# Interface: StanceSelectionCapacityEffect

Defined in: [generated.ts:3803](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3803)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stance-selection-capacity-effect".

## Properties

### type

> **type**: `"stance-selection-capacity"`

Defined in: [generated.ts:3804](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3804)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3805](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3805)

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
