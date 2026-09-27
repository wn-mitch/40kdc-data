[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttachmentCondition

# Interface: AttachmentCondition

Defined in: [generated.ts:1869](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1869)

[composition] leading: the subject model is leading a unit (matching `with`, if given). led: the subject unit is led by a Leader matching `with`. attached: the subject is part of an attached unit.

## Properties

### type

> **type**: `"attachment"`

Defined in: [generated.ts:1870](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1870)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1871](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1871)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### role

> **role**: `"leading"` \| `"led"` \| `"attached"`

#### with?

> `optional` **with?**: [`UnitFilter`](UnitFilter.md)
