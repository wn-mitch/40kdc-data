[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / LeaderAttachment

# Interface: LeaderAttachment

Defined in: [generated.ts:1502](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1502)

Defines which character units can attach to which bodyguard units.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "leader-attachment".

## Properties

### leader\_id

> **leader\_id**: `string`

Defined in: [generated.ts:1503](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1503)

***

### eligible\_bodyguard\_ids

> **eligible\_bodyguard\_ids**: \[`string`, `...string[]`\]

Defined in: [generated.ts:1507](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1507)

#### Min Items

1

***

### eligible\_bodyguard\_keywords?

> `optional` **eligible\_bodyguard\_keywords?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:1513](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1513)

Optional keyword-based eligibility: any unit whose keyword set (keywords ∪ faction_keywords, case-insensitive) contains ALL of these is also an eligible bodyguard, in addition to eligible_bodyguard_ids. Models rules like an Inquisitor leading any IMPERIUM BATTLELINE INFANTRY unit.

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1514](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1514)
