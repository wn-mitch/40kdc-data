[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityDSLCondition9

# Type Alias: AbilityDSLCondition9

> **AbilityDSLCondition9** = [`SimpleCondition`](SimpleCondition.md) \| [`CompoundCondition`](CompoundCondition.md)

Defined in: [generated.ts:1040](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1040)

A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "condition".
