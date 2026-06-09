/**
 * `import` command: turn a ListForge army-list export into a 40kdc roster.
 *
 * Input may be a ListForge URL, a bare base64 segment, an already-decoded JSON
 * string, or a path to a file containing any of those (or `-`/omitted for stdin).
 * The resolved roster is validated against `roster.schema.json` before output —
 * a guard that the importer only ever emits schema-valid rosters.
 *
 * The import is lenient: unresolved entries do not fail the command (exit 0).
 * Only a decode failure or schema-invalid output is fatal (exit 1).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { importListForge } from "../import/index.js";
import { createValidator } from "../schema-loader.js";
import type { Roster } from "../import/index.js";

const ROSTER_SCHEMA_ID = "https://40kdc.dev/schemas/core/roster.schema.json";

interface ImportOpts {
  reporter: string;
  out?: string;
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Resolve the command's input source to a raw payload string. */
function resolveInput(input: string | undefined): string {
  if (!input || input === "-") return readStdin().trim();
  if (existsSync(input)) return readFileSync(input, "utf8").trim();
  return input;
}

function formatPretty(roster: Roster): string {
  const d = roster.diagnostics;
  const lines: string[] = [];
  lines.push(`Roster: ${roster.name}`);
  lines.push(`  Faction:    ${roster.faction_id ?? "(unresolved)"}`);
  lines.push(
    `  Detachments: ${
      roster.detachments
        .map((d) => `${d.ref.id ?? d.ref.raw_name}${d.dp_cost != null ? ` (${d.dp_cost} DP)` : ""}`)
        .join(", ") || "(none/unresolved)"
    }`,
  );
  lines.push(`  Battle size: ${roster.battle_size ?? "(unmapped)"}`);
  lines.push(
    `  Points: computed ${roster.points.total_computed}` +
      (roster.points.total_reported !== null ? `, reported ${roster.points.total_reported}` : "") +
      (roster.points.declared_limit !== null ? `, limit ${roster.points.declared_limit}` : ""),
  );
  lines.push(`  Units (${roster.units.length}):`);
  for (const u of roster.units) {
    const mark = u.ref.resolved ? "✓" : "✗";
    const id = u.ref.resolved ? u.ref.id : `${u.ref.raw_name} → unresolved`;
    const extras: string[] = [];
    if (u.is_warlord) extras.push("warlord");
    if (u.enhancement) extras.push(`enh:${u.enhancement.resolved ? u.enhancement.id : "?"}`);
    if (u.leader_attachment) extras.push(`leads:${u.leader_attachment.bodyguard_ref.id}?`);
    const suffix = extras.length ? ` [${extras.join(", ")}]` : "";
    lines.push(`    ${mark} ${id} ×${u.model_count}${u.points !== null ? ` (${u.points}pts)` : ""}${suffix}`);
  }
  lines.push(
    `  Resolved: ${d.resolved_units} units / ${d.resolved_weapons} weapons; ` +
      `unresolved: ${d.unresolved_units} units / ${d.unresolved_weapons} weapons`,
  );
  if (d.warnings.length) {
    lines.push(`  Warnings (${d.warnings.length}):`);
    for (const w of d.warnings) {
      lines.push(`    - [${w.code}]${w.raw_name ? ` "${w.raw_name}":` : ""} ${w.message}`);
    }
  }
  return lines.join("\n");
}

export async function importCommand(
  input: string | undefined,
  opts: ImportOpts,
): Promise<void> {
  const payload = resolveInput(input);
  if (!payload) {
    console.error("import: no input (provide a URL/base64/JSON argument, a file path, or pipe via stdin)");
    process.exit(1);
  }

  let roster: Roster;
  try {
    roster = importListForge(payload);
  } catch (err) {
    console.error(`import: failed to decode/parse payload: ${(err as Error).message}`);
    process.exit(1);
  }

  // Guard: our own output must be schema-valid.
  const validate = createValidator().getSchema(ROSTER_SCHEMA_ID);
  if (!validate) {
    console.error(`import: roster schema not found (${ROSTER_SCHEMA_ID})`);
    process.exit(1);
  }
  if (!validate(roster)) {
    console.error("import: produced roster failed schema validation:");
    console.error(JSON.stringify(validate.errors, null, 2));
    process.exit(1);
  }

  const json = JSON.stringify(roster, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, json + "\n", "utf8");
    console.error(`Wrote roster → ${opts.out}`);
  }

  if (opts.reporter === "pretty") {
    console.log(formatPretty(roster));
  } else if (!opts.out) {
    console.log(json);
  }
}
