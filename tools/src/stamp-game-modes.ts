/**
 * Stamp `game_modes` on weapons, wargear options and stratagems from the records that use them
 * (see game-mode-stamps.ts). Dry run lists the files that drift; `--write` rewrites them.
 *
 *   npm run stamp:game-modes [-- --write]
 */

import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stampDataRoot } from "./game-mode-stamps.js";

const DATA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
const write = process.argv.includes("--write");
const drifted = stampDataRoot(DATA_ROOT, write);
for (const file of drifted) console.log(`${write ? "stamped" : "drifts"}: ${relative(DATA_ROOT, file)}`);
console.log(`${drifted.length} file(s) ${write ? "stamped" : "drift; rerun with --write"}.`);
