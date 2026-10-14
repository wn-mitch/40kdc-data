// Merges the 40kdc-data entity files the ListForge 11th-edition Reference tab consumes
// into ONE bundle, dist/bundle-core.json, in the shape the app's Kdc40DataService
// expects (top-level entity-type keys → concatenated arrays). Run by
// .github/workflows/publish.yml, which uploads the single file to R2.
//
//   { "version", "generated_at",
//     "factions":[...], "units":[...], "weapons":[...], "detachments":[...],
//     "enhancements":[...], "stratagems":[...], "wargear":[...], "wargear-options":[...],
//     "unit-compositions":[...], "weapon-keywords":[...] }
//
// This repo publishes ONLY the core slice; it publishes no ability prose (rule text lives
// only in the private MFM dump). The client downloads the bundle presigned, via the Fly
// signer — no public bucket, no manifest.
//
// Only whitelisted entity files are included; missions/terrain/_example/_reports/etc.
// are skipped because the app never reads them.

import { mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_CORE = 'data/core';
const OUT = 'dist/bundle-core.json';
const VERSION = process.env.VERSION || new Date().toISOString();

// filename inside a faction dir -> entity-type key (must match what the app reads).
const FACTION_FILE_TYPES = {
  'factions.json': 'factions',
  'units.json': 'units',
  'weapons.json': 'weapons',
  'detachments.json': 'detachments',
  'enhancements.json': 'enhancements',
  'stratagems.json': 'stratagems',
  'wargear.json': 'wargear',
  'wargear-options.json': 'wargear-options',
  'unit-compositions.json': 'unit-compositions',
  'leader-attachments.json': 'leader-attachments',
};
// global files directly under data/core.
const GLOBAL_FILE_TYPES = {
  'weapon-keywords.json': 'weapon-keywords',
  'unit-keywords.json': 'unit-keywords',
  'stratagems.json': 'stratagems',
};

const bundle = { version: VERSION, generated_at: new Date().toISOString() };

function addFile(type, filePath) {
  const arr = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(arr)) return;
  (bundle[type] ??= []).push(...arr);
}

// Global core files.
for (const [f, type] of Object.entries(GLOBAL_FILE_TYPES)) {
  const p = join(DATA_CORE, f);
  if (existsSync(p)) addFile(type, p);
}

// Per-faction files (skip _example / _reports / etc.).
for (const entry of readdirSync(DATA_CORE)) {
  if (entry.startsWith('_')) continue;
  const dir = join(DATA_CORE, entry);
  if (!statSync(dir).isDirectory()) continue;
  for (const [f, type] of Object.entries(FACTION_FILE_TYPES)) {
    const p = join(dir, f);
    if (existsSync(p)) addFile(type, p);
  }
}

mkdirSync('dist', { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle));
const counts = Object.keys(bundle)
    .filter((k) => Array.isArray(bundle[k]))
    .map((k) => `${k}:${bundle[k].length}`)
    .join(' ');
console.log(`Wrote ${OUT}; version=${VERSION}; ${counts}`);
