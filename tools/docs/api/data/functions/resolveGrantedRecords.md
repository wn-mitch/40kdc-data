[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveGrantedRecords

# Function: resolveGrantedRecords()

> **resolveGrantedRecords**(`effect`, `lookup`, `seen?`): `unknown`

Defined in: [cruncher/granted-records.ts:24](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/granted-records.ts#L24)

Rewrite each `ability-grant` that names an ability record by id into a printed grant: its
`definition` is an ability part carrying the record's effect (itself resolved), trigger, usage
and optionality. A grant already carrying a definition, a rules bundle, an id `lookup` does not
resolve (a core ability), and a record in `seen` (the granting ability itself, or a cycle) stay
as they are, so the translator reports them as before. Unchanged subtrees keep their identity.

## Parameters

### effect

`unknown`

### lookup

[`GrantedRecordLookup`](../type-aliases/GrantedRecordLookup.md)

### seen?

`ReadonlySet`\<`string`\> = `...`

## Returns

`unknown`
