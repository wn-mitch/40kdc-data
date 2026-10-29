[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CompoundCondition

# Type Alias: CompoundCondition

> **CompoundCondition** = \{ `operator`: `"and"` \| `"or"`; `operands`: \[[`ConditionNode`](ConditionNode.md), `...ConditionNode[]`\]; \} \| \{ `operator`: `"not"`; `operands`: \[[`ConditionNode`](ConditionNode.md)\]; \}

Defined in: [generated.ts:551](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L551)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "compound-condition".

## Union Members

### Type Literal

\{ `operator`: `"and"` \| `"or"`; `operands`: \[[`ConditionNode`](ConditionNode.md), `...ConditionNode[]`\]; \}

#### operator

> **operator**: `"and"` \| `"or"`

#### operands

> **operands**: \[[`ConditionNode`](ConditionNode.md), `...ConditionNode[]`\]

##### Min Items

1

***

### Type Literal

\{ `operator`: `"not"`; `operands`: \[[`ConditionNode`](ConditionNode.md)\]; \}

#### operator

> **operator**: `"not"`

#### operands

> **operands**: \[[`ConditionNode`](ConditionNode.md)\]

##### Min Items

1

##### Max Items

1
