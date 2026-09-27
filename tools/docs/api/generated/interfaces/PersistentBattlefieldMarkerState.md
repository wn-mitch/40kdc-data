[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PersistentBattlefieldMarkerState

# Interface: PersistentBattlefieldMarkerState

Defined in: [generated.ts:4701](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4701)

A marker placed on the battlefield that persists after placement: matching units may set up near it, using it may consume it, and enemy proximity removes it. Distinct from `tracking-token`, which is a reminder co-located with a model rather than a placed battlefield object with its own lifecycle.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "persistent-battlefield-marker-state".

## Properties

### marker\_label

> **marker\_label**: `string`

Defined in: [generated.ts:4702](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4702)

***

### placement

> **placement**: `"bearer"` \| `"bearer-unit"` \| `"battlefield"`

Defined in: [generated.ts:4706](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4706)

Where the marker is placed at the moment the ability resolves.

***

### setup\_within\_inches?

> `optional` **setup\_within\_inches?**: `number`

Defined in: [generated.ts:4710](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4710)

Distance from the marker within which matching units may be set up.

***

### setup\_keywords?

> `optional` **setup\_keywords?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:4716](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4716)

When present, only units carrying every listed keyword may use the marker to set up; absent means any friendly unit.

#### Min Items

1

***

### consume?

> `optional` **consume?**: `"never"` \| `"on-use"`

Defined in: [generated.ts:4720](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4720)

Whether a single set-up use spends the marker.

***

### removed\_by\_enemy\_within\_inches?

> `optional` **removed\_by\_enemy\_within\_inches?**: `number`

Defined in: [generated.ts:4724](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4724)

Remove the marker once an enemy unit is within this distance of it.
