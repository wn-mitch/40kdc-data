[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EligibleCondition

# Interface: EligibleCondition

Defined in: [generated.ts:1941](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1941)

[state] The subject is eligible to do this. be-selected: eligible for `source_ability`'s selection.

## Properties

### type

> **type**: `"eligible"`

Defined in: [generated.ts:1942](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1942)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1943](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1943)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### to

> **to**: `"fight"` \| `"shoot"` \| `"declare-charge"` \| `"start-action"` \| `"be-selected"`

#### source\_ability?

> `optional` **source\_ability?**: `object`

##### source\_ability.ability\_id

> **ability\_id**: `string`

##### source\_ability.owner?

> `optional` **owner?**: `"friendly"` \| `"enemy"`

#### at?

> `optional` **at?**: `"now"` \| `"opponents-previous-turn-end"`
