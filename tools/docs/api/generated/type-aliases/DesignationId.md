[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DesignationId

# Type Alias: DesignationId

> **DesignationId** = `string`

Defined in: [generated.ts:387](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L387)

A designation (a tag an effect applies: spotted, observer, afflicted, riled-up). Kebab-case id; the describer prints the rules' term from its label table and integrity rejects ids outside the registry. Upper-case legacy spellings are accepted until the record repair normalises them. warlord is the list-building designation: the model chosen as Warlord when mustering. A unit carries it when it contains the Warlord model; a rule may test it but never apply it.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "designation-id".
