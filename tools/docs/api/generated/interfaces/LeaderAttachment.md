[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / LeaderAttachment

# Interface: LeaderAttachment

Defined in: [generated.ts:3315](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3315)

Defines which character units can attach to which bodyguard units.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "leader-attachment".

## Properties

### leader\_id

> **leader\_id**: `string`

Defined in: [generated.ts:3316](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3316)

***

### eligible\_bodyguard\_ids

> **eligible\_bodyguard\_ids**: `string`[]

Defined in: [generated.ts:3317](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3317)

***

### eligible\_bodyguard\_keywords?

> `optional` **eligible\_bodyguard\_keywords?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:3323](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3323)

Optional keyword-based eligibility: any unit whose keyword set (keywords ∪ faction_keywords, case-insensitive) contains ALL of these is also an eligible bodyguard, in addition to eligible_bodyguard_ids. Models rules like an Inquisitor leading any IMPERIUM BATTLELINE INFANTRY unit.

#### Min Items

1

***

### conditional\_groups?

> `optional` **conditional\_groups?**: \[\{ `role`: `"leader"` \| `"support"`; `eligible_bodyguard_ids`: \[`string`, `...string[]`\]; `required_roster_unit_ids?`: \[`string`, `...string[]`\]; `excluded_roster_unit_ids?`: \[`string`, `...string[]`\]; \}, ...\{ role: "leader" \| "support"; eligible\_bodyguard\_ids: \[string, ...string\[\]\]; required\_roster\_unit\_ids?: \[string, ...string\[\]\]; excluded\_roster\_unit\_ids?: \[string, ...string\[\]\] \}\[\]\]

Defined in: [generated.ts:3329](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3329)

Attachment eligibility and role that apply only when all required roster units and no excluded roster units are present.

#### Min Items

1

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3361](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3361)
