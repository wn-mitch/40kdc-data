[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / checkRosterLegality

# Function: checkRosterLegality()

> **checkRosterLegality**(`roster`, `dataset`): [`UnitLegality`](../interfaces/UnitLegality.md)[]

Defined in: [data/roster-resolve.ts:101](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/roster-resolve.ts#L101)

Check every resolved unit in a roster for loadout legality — the building
block for a "is this list legal" report (e.g. a tournament-organiser check).

For each unit it resolves the unit, its authored wargear options and its
unit-composition models the same way the loadout conformance surface does
([resolveRosterUnit](resolveRosterUnit.md) → [Dataset.wargearOptionsOf](../classes/Dataset.md#wargearoptionsof) →
`unitCompositions` by `unit_id`), sums the roster's per-weapon counts, and
runs [validateLoadout](validateLoadout.md). The check is non-destructive and never alters
the roster: an illegal list still imports, it just reports violations — so a
TO can load a player's list verbatim and see exactly what's wrong rather than
have counts silently clamped or the import rejected.

Returns one [UnitLegality](../interfaces/UnitLegality.md) per **resolved** unit, in source order, with
an empty `violations` array when the unit is legal (the entries double as a
record of what was checked). Units the importer couldn't resolve (`ref.id`
null, or an id absent from the dataset) are skipped — they're already flagged
on the roster's `diagnostics`, and there's no datasheet to check them against.
A roster is fully legal iff every entry's `violations` is empty **and** the
roster reports no unresolved units.

## Parameters

### roster

`Roster`

### dataset

[`Dataset`](../classes/Dataset.md)

## Returns

[`UnitLegality`](../interfaces/UnitLegality.md)[]
