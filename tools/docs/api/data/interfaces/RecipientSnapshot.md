[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / RecipientSnapshot

# Interface: RecipientSnapshot

Defined in: [cruncher/recipient-snapshots.ts:6](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/recipient-snapshots.ts#L6)

Caller-attested recipients of one source-owned activation, not current board state.

## Properties

### source

> **source**: `object`

Defined in: [cruncher/recipient-snapshots.ts:8](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/recipient-snapshots.ts#L8)

Exact ability source identity, including the source unit when supplied.

#### kind

> **kind**: `"ability"`

#### abilityId

> **abilityId**: `string`

#### abilityKind

> **abilityKind**: `"unit"` \| `"attached"` \| `"support"` \| `"army"` \| `"detachment"` \| `"detachment-stratagem"`

#### sourceUnitId?

> `optional` **sourceUnitId?**: `string`

For `abilityKind: "attached"`, the combined-unit member the ability
came from (so the UI can name it and show its leader/bodyguard role);
for `"support"`, the other unit that provides it. Absent for other kinds.

#### selectsModel?

> `optional` **selectsModel?**: `true`

For `abilityKind: "detachment-stratagem"`, set when the Stratagem targets one model of the unit.

***

### sourceUnitId

> **sourceUnitId**: `string`

Defined in: [cruncher/recipient-snapshots.ts:10](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/recipient-snapshots.ts#L10)

Unit that owned the source ability when the activation occurred.

***

### trigger

> **trigger**: [`Trigger`](../../generated/interfaces/Trigger.md)

Defined in: [cruncher/recipient-snapshots.ts:12](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/recipient-snapshots.ts#L12)

Exact canonical trigger that established this use, including any parent binding.

***

### selectionPath

> **selectionPath**: `string`

Defined in: [cruncher/recipient-snapshots.ts:14](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/recipient-snapshots.ts#L14)

JSON pointer into the owning ability's effect; the root selection is "".

***

### selector

> **selector**: [`UnitSelector`](../../generated/interfaces/UnitSelector.md)

Defined in: [cruncher/recipient-snapshots.ts:16](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/recipient-snapshots.ts#L16)

Canonical selector used at activation time, including its filter/count/limit.

***

### perspective

> **perspective**: `"attacker"` \| `"target"`

Defined in: [cruncher/recipient-snapshots.ts:18](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/recipient-snapshots.ts#L18)

Buff translation perspective for this source.

***

### recipientUnitId

> **recipientUnitId**: `string`

Defined in: [cruncher/recipient-snapshots.ts:20](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/recipient-snapshots.ts#L20)

Unit receiving the source effect at activation time.

***

### selected

> **selected**: `boolean`

Defined in: [cruncher/recipient-snapshots.ts:22](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/recipient-snapshots.ts#L22)

Whether this recipient was selected by the recorded activation.
