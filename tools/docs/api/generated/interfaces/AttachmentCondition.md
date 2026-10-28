[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttachmentCondition

# Interface: AttachmentCondition

Defined in: [generated.ts:1913](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1913)

[composition] leading: the subject model is leading a unit (matching `with`, if given). led: the subject unit is led by a Leader matching `with`. attached: the subject is part of an attached unit.

## Properties

### type

> **type**: `"attachment"`

Defined in: [generated.ts:1914](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1914)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1915](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1915)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### role

> **role**: `"leading"` \| `"led"` \| `"attached"`

#### with?

> `optional` **with?**: [`UnitFilter`](UnitFilter.md)
