[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / LOADOUT\_CANDIDATES\_TRUNCATED

# Variable: LOADOUT\_CANDIDATES\_TRUNCATED

> `const` **LOADOUT\_CANDIDATES\_TRUNCATED**: `"…truncated"` = `"…truncated"`

Defined in: [data/loadout.ts:1761](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/loadout.ts#L1761)

The sentinel appended as the final entry when [loadoutCandidates](../functions/loadoutCandidates.md) dropped
candidates to honour `limit`. It is never a candidate encoding (no `" => "`),
so a consumer can test for it by equality.
