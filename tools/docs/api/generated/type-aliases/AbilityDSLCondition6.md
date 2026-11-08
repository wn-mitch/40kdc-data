[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityDSLCondition6

# Type Alias: AbilityDSLCondition6

> **AbilityDSLCondition6** = [`SimpleCondition`](SimpleCondition.md) \| [`CompoundCondition`](CompoundCondition.md)

Defined in: [generated.ts:953](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L953)

A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
