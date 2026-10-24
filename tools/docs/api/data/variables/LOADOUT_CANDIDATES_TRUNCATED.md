[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / LOADOUT\_CANDIDATES\_TRUNCATED

# Variable: LOADOUT\_CANDIDATES\_TRUNCATED

> `const` **LOADOUT\_CANDIDATES\_TRUNCATED**: `"…truncated"` = `"…truncated"`

Defined in: [data/loadout.ts:1425](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/loadout.ts#L1425)

The sentinel appended as the final entry when [loadoutCandidates](../functions/loadoutCandidates.md) dropped
candidates to honour `limit`. It is never a candidate encoding (no `" => "`),
so a consumer can test for it by equality.
