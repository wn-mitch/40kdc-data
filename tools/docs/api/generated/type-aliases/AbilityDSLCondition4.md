[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityDSLCondition4

# Type Alias: AbilityDSLCondition4

> **AbilityDSLCondition4** = [`SimpleCondition`](SimpleCondition.md) \| [`CompoundCondition`](CompoundCondition.md)

Defined in: [generated.ts:666](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L666)

A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
