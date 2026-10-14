/**
 * Translates ability DSL entries into plain English descriptions.
 *
 * Thin CLI shell over the shared `translate/effect.ts` describer (the
 * conformance-pinned `ability.print()`); this file only handles file loading
 * and per-ability presentation.
 *
 * Pass `--gw` to show each ability's GW source text (from the private MFM dump,
 * `_private/dump.json`) above its generated description, or `--gw-file` to read
 * it from any private JSON array of `{ ability_id, raw_text | src.description |
 * when/target/effect/restrictions }` entries.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

import {
  describeAbility,
  type AbilityAppliesTo,
  type AbilityScope,
  type AbilityTriggerSpec,
  type AbilityUsage,
  type Effect,
} from "../translate/effect.js";
import { DEFAULT_DUMP_PATH } from "../mfm/loader.js";
import { loadRepoProse } from "../mfm/record-prose.js";


interface Ability {
  ability_id: string;
  name: string;
  ability_type?: string;
  behavior?: string;
  detachment_id?: string | null;
  faction_id?: string | null;
  unit_ids?: string[];
  effect: Effect;
  scope?: AbilityScope;
  trigger?: AbilityTriggerSpec | null;
  usage?: AbilityUsage | null;
  applies_to?: AbilityAppliesTo | null;
}

interface SourceEntry {
  ability_id?: string;
  id?: string;
  raw_text?: string;
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
  src?: { description?: string };
}

export interface TranslateOptions {
  gw?: boolean;
  gwFile?: string;
}

/**
 * Source text keyed by ability_id: from `--gw-file` when given, else the dump's
 * prose for the abilities file's faction dir (`data/enrichment/<faction>/`).
 */
export function loadGwText(
  abilitiesPath: string,
  opts: TranslateOptions,
  dumpEntries: (faction: string) => SourceEntry[] = (faction) =>
    existsSync(DEFAULT_DUMP_PATH) ? [...loadRepoProse().faction(faction).values()] : [],
): Map<string, string> {
  let entries: SourceEntry[];
  if (opts.gwFile) {
    if (!existsSync(opts.gwFile)) return new Map();
    entries = JSON.parse(readFileSync(opts.gwFile, "utf-8"));
  } else {
    entries = dumpEntries(basename(dirname(abilitiesPath)));
  }
  const out = new Map<string, string>();
  for (const entry of entries) {
    const id = entry.ability_id ?? entry.id;
    const text =
      entry.raw_text?.trim() ??
      entry.src?.description?.trim() ??
      [entry.when, entry.target, entry.effect, entry.restrictions]
        .filter(
          (part): part is string =>
            typeof part === "string" && part.trim().length > 0,
        )
        .join("\n")
        .trim();
    if (id && text) out.set(id, text);
  }
  return out;
}

export async function translateCommand(
  path?: string,
  opts: TranslateOptions = {},
): Promise<void> {
  const filePath = resolve(
    process.cwd(),
    path ?? "../data/enrichment/world-eaters/abilities.json",
  );
  const abilities: Ability[] = JSON.parse(readFileSync(filePath, "utf-8"));

  const gwText = opts.gw
    ? loadGwText(filePath, opts)
    : new Map<string, string>();

  for (const a of abilities) {
    const meta: string[] = [];
    if (a.ability_type) meta.push(a.ability_type);
    if (a.behavior) meta.push(a.behavior);
    if (a.detachment_id) meta.push(`detachment: ${a.detachment_id}`);
    if (a.unit_ids?.length) meta.push(`units: ${a.unit_ids.join(", ")}`);

    console.log(`\n═══ ${a.name} [${a.ability_id}] ═══`);
    if (meta.length) console.log(`    ${meta.join(" | ")}`);

    const gw = gwText.get(a.ability_id);
    if (gw) {
      console.log(`\n  [GW]\n${indent(gw, "  ")}`);
      console.log(`\n  [DSL→EN]`);
    }
    console.log(
      describeAbility({
        effect: a.effect,
        scope: a.scope,
        trigger: a.trigger,
        usage: a.usage,
        applies_to: a.applies_to,
      }),
    );
  }

  const gwCoverage =
    gwText.size > 0
      ? `  (${gwText.size}/${abilities.length} have GW source text)`
      : "";
  console.log(`\n── ${abilities.length} abilities translated ──${gwCoverage}`);
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}
