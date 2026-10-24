[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ObjectiveFilter

# Interface: ObjectiveFilter

Defined in: [generated.ts:1506](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1506)

Which objectives. Every listed property must hold.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "objective-filter".

## Properties

### role?

> `optional` **role?**: `"central"` \| `"expansion"` \| `"home"` \| `"non-home"`

Defined in: [generated.ts:1507](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1507)

***

### home\_of?

> `optional` **home\_of?**: `"friendly"` \| `"enemy"`

Defined in: [generated.ts:1511](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1511)

The friendly or the enemy home objective.

***

### territory?

> `optional` **territory?**: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"`

Defined in: [generated.ts:1512](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1512)

***

### controlled\_by?

> `optional` **controlled\_by?**: [`Owner`](../type-aliases/Owner.md)

Defined in: [generated.ts:1513](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1513)

***

### designated?

> `optional` **designated?**: `string`

Defined in: [generated.ts:1514](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1514)

***

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:1518](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1518)

Kebab-case identifier

***

### selection\_var?

> `optional` **selection\_var?**: `string`

Defined in: [generated.ts:1522](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1522)

The objective marker a select-objective step bound.
