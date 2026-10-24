[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CompoundCondition

# Type Alias: CompoundCondition

> **CompoundCondition** = \{ `operator`: `"and"` \| `"or"`; `operands`: \[[`ConditionNode`](ConditionNode.md), `...ConditionNode[]`\]; \} \| \{ `operator`: `"not"`; `operands`: \[[`ConditionNode`](ConditionNode.md)\]; \}

Defined in: [generated.ts:551](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L551)

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
