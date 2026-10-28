[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / LeaderAttachment

# Interface: LeaderAttachment

Defined in: [generated.ts:3188](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3188)

Defines which character units can attach to which bodyguard units.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "leader-attachment".

## Properties

### leader\_id

> **leader\_id**: `string`

Defined in: [generated.ts:3189](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3189)

***

### eligible\_bodyguard\_ids

> **eligible\_bodyguard\_ids**: `string`[]

Defined in: [generated.ts:3190](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3190)

***

### eligible\_bodyguard\_keywords?

> `optional` **eligible\_bodyguard\_keywords?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:3196](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3196)

Optional keyword-based eligibility: any unit whose keyword set (keywords ∪ faction_keywords, case-insensitive) contains ALL of these is also an eligible bodyguard, in addition to eligible_bodyguard_ids. Models rules like an Inquisitor leading any IMPERIUM BATTLELINE INFANTRY unit.

#### Min Items

1

***

### conditional\_groups?

> `optional` **conditional\_groups?**: \[\{ `role`: `"leader"` \| `"support"`; `eligible_bodyguard_ids`: \[`string`, `...string[]`\]; `required_roster_unit_ids?`: \[`string`, `...string[]`\]; `excluded_roster_unit_ids?`: \[`string`, `...string[]`\]; \}, ...\{ role: "leader" \| "support"; eligible\_bodyguard\_ids: \[string, ...string\[\]\]; required\_roster\_unit\_ids?: \[string, ...string\[\]\]; excluded\_roster\_unit\_ids?: \[string, ...string\[\]\] \}\[\]\]

Defined in: [generated.ts:3202](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3202)

Attachment eligibility and role that apply only when all required roster units and no excluded roster units are present.

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3234](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3234)
