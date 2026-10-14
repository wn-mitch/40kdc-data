[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StanceSelectionCapacityEffect

# Interface: StanceSelectionCapacityEffect

Defined in: [generated.ts:3448](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3448)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stance-selection-capacity-effect".

## Properties

### type

> **type**: `"stance-selection-capacity"`

Defined in: [generated.ts:3449](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3449)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3450](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3450)

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
