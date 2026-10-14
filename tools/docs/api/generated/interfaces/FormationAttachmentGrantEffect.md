[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / FormationAttachmentGrantEffect

# Interface: FormationAttachmentGrantEffect

Defined in: [generated.ts:3287](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3287)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "formation-attachment-grant-effect".

## Properties

### type

> **type**: `"formation-attachment-grant"`

Defined in: [generated.ts:3288](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3288)

***

### source

> **source**: `"self"` \| `"bearer-unit"`

Defined in: [generated.ts:3289](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3289)

***

### beneficiary

> **beneficiary**: `"self"` \| `"attached-leader-model"`

Defined in: [generated.ts:3290](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3290)

***

### formation\_event

> **formation\_event**: `"declare-battle-formations"`

Defined in: [generated.ts:3291](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3291)

***

### attachment

> **attachment**: `object`

Defined in: [generated.ts:3292](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3292)

#### leader\_id?

> `optional` **leader\_id?**: `string`

#### bodyguard\_id

> **bodyguard\_id**: `string`

***

### grant

> **grant**: `object`

Defined in: [generated.ts:3296](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3296)

#### recipient

> **recipient**: `"beneficiary"`

#### effect

> **effect**: [`BeneficiaryBoundEffectNode`](BeneficiaryBoundEffectNode.md)
