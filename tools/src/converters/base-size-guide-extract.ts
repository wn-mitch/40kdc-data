/**
 * Extract base-size rows from the GW *Chapter Approved Tournament Companion —
 * Base Size Guide* into a committed numerical-facts table.
 *
 * IP: base sizes are numerical facts (same category as stat lines / points, which
 * the project permits) and unit/model names are entity identifiers already present
 * in the dataset. We never commit the PDF or any prose/artwork from it — only the
 * name → size rows. The source document is cited, not reproduced.
 *
 * Usage (one-time, from a locally-downloaded PDF; the PDF stays uncommitted):
 *   pdftotext -layout tournament-companion.pdf tc.txt
 *   tsx src/converters/base-size-guide-extract.ts tc.txt > src/converters/data/base-size-guide.json
 *
 * `-layout` mode keeps each "<unit name>   <base size>" pair on one physical line,
 * so the two-column tables parse line-by-line. Multi-model datasheets appear as
 * "Unit: ModelLabel" rows; shared rows as "UnitA/UnitB: ModelLabel".
 */
import { readFileSync } from "node:fs";

export interface GuideRow {
  /** Left-of-colon datasheet name(s). May be "A/B" for shared rows. */
  unit: string;
  /** Right-of-colon per-model label, when the row is model-specific. */
  model?: string;
  /** Verbatim base-size string (e.g. "32mm", "60 x 35.5mm Oval Base", "Hull"). */
  raw: string;
}

/** A base-size token at the end of a guide line: round, oval, Hull, Unique, or a flying base. */
const SIZE_TOKEN =
  "(?:\\d+(?:\\.\\d+)?\\s*[xX×]\\s*\\d+(?:\\.\\d+)?\\s*mm(?:\\s*Oval Base)?)" + // oval
  "|(?:\\d+(?:\\.\\d+)?\\s*mm)" + // round
  "|Hull|Unique|(?:Large|Small) Flying Base";

const LINE_RE = new RegExp(`^(.*\\S)\\s{2,}(${SIZE_TOKEN})\\s*$`);

/** Parse the layout-mode text of the Base Size Guide into structured rows. */
export function extractGuideRows(layoutText: string): GuideRow[] {
  const lines = layoutText.split(/\r?\n/);
  const start = lines.findIndex((l) => /BASE SIZE GUIDE/.test(l));
  const region = start >= 0 ? lines.slice(start) : lines;

  const rows: GuideRow[] = [];
  for (const line of region) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const name = m[1].trim();
    const raw = m[2].trim();
    const colon = name.indexOf(":");
    if (colon >= 0) {
      rows.push({ unit: name.slice(0, colon).trim(), model: name.slice(colon + 1).trim(), raw });
    } else {
      rows.push({ unit: name, raw });
    }
  }
  return rows;
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: base-size-guide-extract.ts <pdftotext -layout output>");
    process.exit(2);
  }
  const rows = extractGuideRows(readFileSync(path, "utf8"));
  process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
  console.error(`extracted ${rows.length} rows`);
}

// Run as a script (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) main();
