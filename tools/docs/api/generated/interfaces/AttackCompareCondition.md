[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AttackCompareCondition

# Interface: AttackCompareCondition

Defined in: [generated.ts:2528](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2528)

[attack] Compares a stat of one side of the attack with a stat of the other, or with a value.

## Properties

### type

> **type**: `"attack-compare"`

Defined in: [generated.ts:2529](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2529)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2530](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2530)

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
