[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttachmentCondition

# Interface: AttachmentCondition

Defined in: [generated.ts:2009](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2009)

[composition] leading: the subject model is leading a unit (matching `with`, if given). led: the subject unit is led by a Leader matching `with`. attached: the subject is part of an attached unit.

## Properties

### type

> **type**: `"attachment"`

Defined in: [generated.ts:2010](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2010)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2011](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2011)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### role

> **role**: `"leading"` \| `"led"` \| `"attached"`

#### with?

> `optional` **with?**: [`UnitFilter`](UnitFilter.md)
