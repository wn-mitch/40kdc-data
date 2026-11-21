# Mission Scoring, Terrain Geometry, and Schema Validation

Alongside the dataset, roster pipeline, and cruncher, `40kdc-data` provides pure cross-language modules for mission VP scoring, board-space terrain resolution, and JSON Schema validation.

## Mission Scoring

Mission cards store structured scoring awards. You can render each card's scoring rules into plain English, compute turn VP with exclusive-tier and cap handling, track full-game scoring state, and map final VP totals to the 20-point WTC band:

```ts
import {
  awardsOf,
  describeScoringCard,
  missionCards,
  scoreTurn,
  wtcResult,
} from "@alpaca-software/40kdc-data";

const card = missionCards.all[0]!;
const lines = describeScoringCard(card);

const awards = awardsOf(card);
const turnVp = scoreTurn([{ award: awards[0]!, count: 2 }]);

const match = wtcResult(84, 71); // { a: 12, b: 8 }
```

## Terrain Geometry and Keystones

Terrain layouts reference reusable footprint templates by ID and centroid position. `resolveLayout` transforms every area piece, composed feature, and wall into absolute board-space coordinates (inches, y-down), and `keystoneMeasurements` derives board-edge placement distances directly from the resolved geometry:

```ts
import {
  keystoneMeasurements,
  resolveLayout,
  terrainLayouts,
  terrainTemplates,
} from "@alpaca-software/40kdc-data";

const layout = terrainLayouts.all[0]!;
const templates = terrainTemplates.all;

const pieces = resolveLayout(layout, templates);
const keystones = keystoneMeasurements(layout, templates);
```

## Schema Validation

Schema validation is exposed through the `@alpaca-software/40kdc-data/validate` subpath (Node only, keeping the main package barrel browser-safe):

```ts
import { createValidator, listSchemaIds } from "@alpaca-software/40kdc-data/validate";

const validate = createValidator();
const valid = validate("https://40kdc.dev/schemas/core/unit.schema.json", myUnitJson);
```

From the command line, `40kdc-validate` checks data files against all schemas and cross-record referential integrity rules.
