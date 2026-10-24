/**
 * Full local-stack damage matrix.
 *
 * `npm run damage:stack` evaluates the configured faction × target × phase
 * cross product through the same public Dataset/loadout/crunch surfaces used by
 * Salvo. Configuration and the resumable JSON report live in
 * `src/stack-damage/`; this file intentionally remains the stable CLI entrypoint.
 */
import { runDamageMatrix } from "./stack-damage/runner.js";

runDamageMatrix();
