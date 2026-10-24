[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / LeaderAttachment

# Interface: LeaderAttachment

Defined in: [generated.ts:2843](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2843)

Defines which character units can attach to which bodyguard units.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "leader-attachment".

## Properties

### leader\_id

> **leader\_id**: `string`

Defined in: [generated.ts:2844](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2844)

***

### eligible\_bodyguard\_ids

> **eligible\_bodyguard\_ids**: \[`string`, `...string[]`\]

Defined in: [generated.ts:2848](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2848)

#### Min Items

1

***

### eligible\_bodyguard\_keywords?

> `optional` **eligible\_bodyguard\_keywords?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:2854](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2854)

Optional keyword-based eligibility: any unit whose keyword set (keywords ∪ faction_keywords, case-insensitive) contains ALL of these is also an eligible bodyguard, in addition to eligible_bodyguard_ids. Models rules like an Inquisitor leading any IMPERIUM BATTLELINE INFANTRY unit.

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:2855](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2855)
