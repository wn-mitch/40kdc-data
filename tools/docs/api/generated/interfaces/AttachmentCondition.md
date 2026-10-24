[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttachmentCondition

# Interface: AttachmentCondition

Defined in: [generated.ts:1613](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1613)

[composition] leading: the subject model is leading a unit (matching `with`, if given). led: the subject unit is led by a Leader matching `with`. attached: the subject is part of an attached unit.

## Properties

### type

> **type**: `"attachment"`

Defined in: [generated.ts:1614](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1614)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1615](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1615)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### role

> **role**: `"leading"` \| `"led"` \| `"attached"`

#### with?

> `optional` **with?**: [`UnitFilter`](UnitFilter.md)
