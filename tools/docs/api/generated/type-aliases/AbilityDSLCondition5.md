[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityDSLCondition5

# Type Alias: AbilityDSLCondition5

> **AbilityDSLCondition5** = [`SimpleCondition`](SimpleCondition.md) \| [`CompoundCondition`](CompoundCondition.md)

Defined in: [generated.ts:931](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L931)

A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
