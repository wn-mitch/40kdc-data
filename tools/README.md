# @alpaca-software/40kdc-data

Published by [Alpaca Software](https://alpacasoft.dev).

The [40kdc](https://40kdc.alpacasoft.dev) Warhammer 40,000
dataset behind a **linked, typed API**. Find a unit, then walk straight to its
weapons, abilities, the game phases those abilities act in, and its faction —
all strongly typed, all resolved for you.

The full dataset is embedded in the package, so there is no network call, no
database, and no filesystem access at runtime. It works the same in Node,
bundlers, and the browser.

```ts
import { units } from "@alpaca-software/40kdc-data";

units.find("Kharn")!.abilities
  .filter(a => a.phases.includes("fight"))
  .map(a => a.id); // ["legendary-killer", "berzerker-frenzy"]
```

## Install

```bash
npm install @alpaca-software/40kdc-data
```

## The shape

Top-level collections (`units`, `weapons`, `factions`, `abilities`,
`detachments`, `stratagems`, …) are accessors over a single embedded
[`Dataset`](docs/api/data/classes/Dataset.md). Each collection is iterable and
offers:

| Method | Returns |
| --- | --- |
| `.all` | every record (deduplicated) |
| `.get(id)` | one record by exact id |
| `.find(nameOrId)` | first match by id or name |
| `.findAll(nameOrId)` | every match (surfaces names shared across factions) |
| `.byFaction(id)` | records belonging to a faction |

Records resolve their links lazily:

- `unit.faction`, `unit.weapons`, `unit.abilities`
- `ability.phases` (joined from `phase-mappings`), `ability.units`
- `weapon.units`
- `faction.units`, `faction.abilities`, `faction.weapons`

The full underlying record is always available via `.raw`.

### Name matching is built for a global player base

Warhammer 40,000 is played worldwide, and many names carry diacritics or
punctuation — "Khârn the Betrayer", "T'au", "Be'lakor". `find`/`findAll` are
diacritic- and punctuation-insensitive, so `find("Kharn")` resolves "Khârn the
Betrayer" and `find("Belakor")` resolves "Be'lakor". The exact rule is exported
as `normalizeName` so you can reproduce it in your own search UI.

## API reference

Auto-generated from the source: [`docs/api/`](docs/api/README.md).

## See it in action

Open-source example apps built on this package:

- [List Builder](https://list-builder.alpacasoft.dev) — build an army list and export to ListForge / NewRecruit.
- [Salvo](https://salvo.alpacasoft.dev) — damage calculator over the cruncher and abilities-resolver.
- [Mission Matrix](https://mission-matrix.alpacasoft.dev) — the 11th-edition Force Disposition matchup grid.
- [Layout Editor](https://layout-editor.alpacasoft.dev) — author terrain layouts on a board; exports terrain-layout JSON.
- [Hull Tracer](https://hull-tracer.alpacasoft.dev) — trace a model's collision hull from a top-down photo; exports geometry-only hull-shape JSON.

## Complete lever selections

`Dataset.stackableBuffsFor` returns stable lever ids, intersecting activation
pools, provider dependencies, and exact option-capacity metadata. Validate a
complete proposed selection with the public `isLegalLeverSelection` helper
before passing its contributions to `crunch`; a scalar sum of pool caps is not
equivalent when pools overlap or a raise is fixed to a subset of option ids.

```ts
import { isLegalLeverSelection } from "@alpaca-software/40kdc-data";

const { buffs, groups } = dataset.stackableBuffsFor(input, context);
const selectedIds = new Set(buffs.filter(b => b.enabled).map(b => b.id));
if (isLegalLeverSelection(buffs, groups, selectedIds)) {
  // Use only the contributions from this complete, legal selection.
}

```

`id` and `{ability_id, option_id}` references are stable identities; display
labels and option names are presentation only.

## Local-stack damage matrix

`npm run damage:stack` exercises the same public damage path as Salvo:
`Dataset.stackableBuffsFor`, `isLegalLeverSelection`,
`Dataset.defensiveBuffsFor`, the shared loadout helpers, and `crunch`. It searches
a local combined unit (bodyguard plus legal leader/support attachments), up to
three detachments within three detachment points, legal Enhancements, at most
one Stratagem, and external supporting abilities. This is deliberately not a
whole-army roster optimizer.

The default scope is the four fully ported factions
`chaos-space-marines,adeptus-mechanicus,death-guard,tau-empire`, every target
profile, and both `shooting,fight`. Override it with comma-separated
`HC_FACTIONS`, `HC_TARGETS` (`all` or ids), and `HC_PHASES`. `HC_OUTPUT` selects
the resumable JSON report. `HC_BODYGUARDS`, `HC_TOP`, and `HC_DEEP` accept a
positive integer or `Infinity`; all three default to `Infinity`, so candidate
truncation is never silent. Loadout legality remains exhaustive; its assignment
search prunes only equipment totals that no later replacement can reduce and
prioritizes exact target bags without changing rendered loadout grouping. The
report records effective limits, assumptions, lever requirements and costs,
supporting units, legal loadouts, defensive translation warnings, and every
unsupported mechanic without embedding source rules text.

Expanding this campaign to 27 factions requires an explicit ordered 27-faction
manifest. The data package exposes more faction views than that and does not
define which 27 belong to this campaign, so directory enumeration is not a
stable substitute.

## Also: schema validation

This package also ships the canonical JSON Schemas and an AJV-based validator
(`createValidator`, `listSchemaIds`, and the `40kdc-validate` CLI) for checking
data against them. See the repository root for schema details.

## Licensing & attribution

- Code (`tools/`): **MIT + attribution requirement** — see [LICENSE-TOOLS](../LICENSE-TOOLS).
- Embedded enrichment data (`data/enrichment/`): **CC BY 4.0** —
  attribution: *Alpaca Software and the 40kdc community contributors*
  (<https://github.com/wn-mitch/40kdc-data>).
- JSON Schemas: **CC0**.

**Public deployment requirement:** Any publicly accessible application or
service that ships this package as part of its end-user product must display a
visible credit containing the text **"Powered by 40kdc-data"** and a link to
<https://40kdc.alpacasoft.dev> in a user-accessible location (footer, about
page, or credits section). Private use and library redistribution are exempt.

Stat lines and points are numerical facts. Ability and rules text are never
stored — abilities are community-authored structured mechanics (the Ability
DSL), not reproductions of copyrighted text.
