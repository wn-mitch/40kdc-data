[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttackCompareCondition

# Interface: AttackCompareCondition

Defined in: [generated.ts:2103](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2103)

[attack] Compares a stat of one side of the attack with a stat of the other, or with a value.

## Properties

### type

> **type**: `"attack-compare"`

Defined in: [generated.ts:2104](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2104)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2105](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2105)

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
