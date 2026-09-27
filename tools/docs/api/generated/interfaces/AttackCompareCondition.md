[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttackCompareCondition

# Interface: AttackCompareCondition

Defined in: [generated.ts:2079](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2079)

[attack] Compares a stat of one side of the attack with a stat of the other, or with a value.

## Properties

### type

> **type**: `"attack-compare"`

Defined in: [generated.ts:2080](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2080)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2081](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2081)

#### left

> **left**: `object`

##### left.of

> **of**: `"attacker"` \| `"defender"`

##### left.stat

> **stat**: `string`

##### left.reduce?

> `optional` **reduce?**: `"max"` \| `"min"`

#### comparison

> **comparison**: `"greater-than"` \| `"greater-or-equal"` \| `"less-than"` \| `"equal-to"` \| `"less-or-equal"`

#### right

> **right**: \{ `of`: `"attacker"` \| `"defender"`; `stat`: `string`; `reduce?`: `"max"` \| `"min"`; \} \| \{ `value`: `number`; \}
