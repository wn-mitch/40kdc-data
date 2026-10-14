[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MiracleDieOperationEffect

# Interface: MiracleDieOperationEffect

Defined in: [generated.ts:3249](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3249)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "miracle-die-operation-effect".

## Properties

### type

> **type**: `"miracle-die-operation"`

Defined in: [generated.ts:3250](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3250)

***

### target

> **target**: `"self"`

Defined in: [generated.ts:3251](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3251)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3252](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3252)

#### operation

> **operation**: `"reroll-generated-result"` \| `"set-generated-value-without-roll"` \| `"set-used-value"` \| `"reroll-retained-and-return"`

#### die?

> `optional` **die?**: [`MiracleDieReference`](MiracleDieReference.md)

#### value?

> `optional` **value?**: `number`

#### pool\_id

> **pool\_id**: `"miracle-dice-pool"`

#### resource\_label

> **resource\_label**: `"Miracle dice"`

#### stage?

> `optional` **stage?**: `"before-pool-add"` \| `"before-act-of-faith-resolution"`

#### selection?

> `optional` **selection?**: `object`

##### selection.count

> **count**: `1` \| \{ `minimum`: `1`; `maximum`: `1` \| `3`; \}

##### selection.from

> **from**: `"dice-used-in-triggering-act-of-faith"` \| `"retained-pool-dice"`

##### selection.policy

> **policy**: `"controller-chooses"`

#### optional?

> `optional` **optional?**: `boolean`
