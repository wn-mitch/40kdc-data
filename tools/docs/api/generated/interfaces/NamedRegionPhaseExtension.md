[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedRegionPhaseExtension

# Interface: NamedRegionPhaseExtension

Defined in: [generated.ts:4619](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4619)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-region-phase-extension".

## Properties

### kind

> **kind**: `"objective-majority-zone"`

Defined in: [generated.ts:4620](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4620)

***

### zone

> **zone**: `"no-mans-land"` \| `"opponent-deployment-zone"`

Defined in: [generated.ts:4621](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4621)

***

### control\_gate

> **control\_gate**: `object`

Defined in: [generated.ts:4622](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4622)

#### marker\_scope

> **marker\_scope**: `"markers-in-zone"`

#### controlled\_by

> **controlled\_by**: `"owner-army"`

#### threshold

> **threshold**: `object`

##### threshold.comparison

> **comparison**: `"at-least"`

##### threshold.fraction

> **fraction**: `0.5`

***

### activation

> **activation**: `object`

Defined in: [generated.ts:4630](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4630)

#### event

> **event**: `"phase-start"`

#### evaluation

> **evaluation**: `"snapshot-once"`

#### canonical\_condition\_ids

> **canonical\_condition\_ids**: \[`"controls"`\]

***

### expiry

> **expiry**: `object`

Defined in: [generated.ts:4635](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4635)

#### event

> **event**: `"phase-end"`
