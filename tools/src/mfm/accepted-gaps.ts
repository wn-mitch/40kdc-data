import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT } from "./repo-files.js";

interface GapManifest {
  categories?: Record<string, Record<string, string[]>>;
}

const GAPS_PATH = path.join(REPO_ROOT, "data", "_audit", "mfm-gaps.json");

/** Read the committed, reviewed MFM gaps for one entity category and repo scope. */
export function acceptedGapIds(category: string, scope: string): ReadonlySet<string> {
  if (!fs.existsSync(GAPS_PATH)) return new Set();
  const manifest = JSON.parse(fs.readFileSync(GAPS_PATH, "utf8")) as GapManifest;
  return new Set(manifest.categories?.[category]?.[scope] ?? []);
}
