[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttackCompareCondition

# Interface: AttackCompareCondition

Defined in: [generated.ts:2417](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2417)

[attack] Compares a stat of one side of the attack with a stat of the other, or with a value.

## Properties

### type

> **type**: `"attack-compare"`

Defined in: [generated.ts:2418](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2418)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2419](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2419)

#### left

> **left**: `object`

##### left.of

> **of**: `"attacker"` \| `"defender"`

##### left.stat

> **stat**: [`Stat`](../type-aliases/Stat.md)

##### left.reduce?

> `optional` **reduce?**: `"max"` \| `"min"`

#### comparison

> **comparison**: [`Comparison`](../type-aliases/Comparison.md)

#### right

> **right**: \{ `of`: `"attacker"` \| `"defender"`; `stat`: [`Stat`](../type-aliases/Stat.md); `reduce?`: `"max"` \| `"min"`; \} \| \{ `value`: `number`; \}
