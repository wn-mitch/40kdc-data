# Army Lists: Import, Export, Legality, and Share Tokens

`40kdc-data` includes a unified army-list pipeline across TypeScript, Rust, Python, and Go. You can parse lists from external builders into one canonical `Roster` model, validate army and wargear legality, re-export to any supported format, or pack the list into a short URL share token.

## Importing an Army List

`importRoster` detects the format automatically and resolves faction, detachment, unit, wargear, and enhancement names against the embedded dataset. Supported input formats:

- ListForge (share URL, base64 payload, JSON, or text export)
- NewRecruit (JSON, `wtc-compact`, `wtc-full`, `simple`)
- Games Workshop app text export
- Rosterizer
- Canonical 40kdc Roster JSON

```ts
import { dataset, importRoster, tryImportRoster } from "@alpaca-software/40kdc-data";

// Throws on unparseable input:
const roster = importRoster(rawTextOrJson, dataset);

// Non-throwing variant with per-adapter failure diagnostics:
const result = tryImportRoster(rawTextOrJson, dataset);
if (result.ok) {
  console.log(result.roster.faction.id, result.roster.points.total);
  console.log(
    `${result.roster.diagnostics.resolved_units}/${result.roster.units.length} units resolved`,
  );
}
```

Resolution is lenient: unrecognized names are preserved with candidate suggestions and surfaced in `roster.diagnostics` rather than dropped. If a list uses a Combat Patrol detachment, it automatically resolves against the `combat-patrol` game-mode view.

## Walking Resolved Roster Units

Use `resolveRosterUnit` to jump from a `RosterUnit` directly to its linked `UnitView`:

```ts
import { dataset, resolveRosterUnit } from "@alpaca-software/40kdc-data";

for (const entry of roster.units) {
  const unit = resolveRosterUnit(entry, dataset);
  console.log(entry.ref.raw_name, "->", unit?.id, `${entry.points} pts`);
}
```

## Exporting to Other Formats

`exportRoster` converts any `Roster` into any of the 9 supported export formats:

- `newrecruit-json`
- `newrecruit-wtc-compact`
- `newrecruit-wtc-full`
- `newrecruit-simple`
- `roster-json`
- `rosterizer`
- `atc-2026-compact`
- `atc-2026-full`
- `yellowscribe` (requires `dataset` so stat lines, weapons, and generated ability descriptions are embedded)

```ts
import { dataset, exportRoster } from "@alpaca-software/40kdc-data";

const wtcText = exportRoster(roster, "newrecruit-wtc-compact");
const atcText = exportRoster(roster, "atc-2026-full");
const yellowscribeXml = exportRoster(roster, "yellowscribe", dataset);
```

## Checking Roster and Wargear Legality

`checkRoster` validates whole-army legality (points cap, detachment points budget, Warlord, Force Disposition, epic heroes, rule-of-three, allies, and per-unit loadouts). `checkRosterLegality` checks per-unit loadout legality individually:

```ts
import { checkRoster, checkRosterLegality, dataset } from "@alpaca-software/40kdc-data";

const legality = checkRoster(roster, dataset);
if (!legality.legal) {
  for (const violation of legality.violations) {
    console.log(`[${violation.severity}] ${violation.code}: ${violation.message}`);
  }
}

const unitChecks = checkRosterLegality(roster, dataset);
```

For interactive list builders, you can also query a unit's default MFM loadout, legal weapon bounds, and next-copy affordability:

```ts
import {
  candidateAffordability,
  checkMfmLoadout,
  defaultMfmLoadout,
  units,
} from "@alpaca-software/40kdc-data";

const unit = units.find("Intercessor Squad")!;
const loadoutView = dataset.loadoutOf(unit);
```

## Compact URL Share Tokens (`share-v1`)

To share an entire army list in a URL fragment (`#l=<token>`) without a backend, convert the roster to a `ShareList` and encode it with `encodeShareToken`:

```ts
import {
  dataset,
  decodeShareToken,
  encodeShareToken,
  rosterToShareList,
  shareListToRoster,
} from "@alpaca-software/40kdc-data";

const token = encodeShareToken(rosterToShareList(roster));
const decoded = decodeShareToken(token);

if (decoded.ok) {
  const rebuilt = shareListToRoster(decoded.list, dataset);
}
```

See [`tools/docs/share-token.md`](../../tools/docs/share-token.md) for the binary wire layout and append-only registry guarantees.
