[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitStateCondition

# Interface: UnitStateCondition

Defined in: [generated.ts:1929](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1929)

[state] The subject is in this core-rules state. `with` narrows engaged to one unit; `at` reads the state at an earlier point.

## Properties

### type

> **type**: `"unit-state"`

Defined in: [generated.ts:1930](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1930)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1931](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1931)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### state

> **state**: [`UnitState`](../type-aliases/UnitState.md)

#### with?

> `optional` **with?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### at?

> `optional` **at?**: `"now"` \| `"phase-start"` \| `"turn-start"`
