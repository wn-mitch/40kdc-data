import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { sameSentence } from "./compile-named-ability.js";
import { setUpWindow } from "./compile-history-values.js";
import { WINDOWED_DESTRUCTION } from "./families/unit-activity.js";

/**
 * "... destroyed one or more X units from your army during the battle", "set up using the Foo
 * ability this turn": a `history-window` leaf names the window of the history condition before it.
 * The fold stores the window on that leaf, extends the leaf over the window's words and removes the
 * window leaf. Leaves between a history condition and its window that only describe the units it
 * names (a unit-filter, its owner, a distance) are skipped.
 */

const BETWEEN = new Set(["unit-filter", "unit-owner", "unit-position", "aura-range"]);
export function foldHistoryWindow(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "history-window")) return [...list];
  const out: CompileLeaf[] = [];
  const hosted = new Set<CompileLeaf>();
  for (const leaf of list) {
    if (leaf.family_id !== "history-window") {
      out.push(leaf);
      continue;
    }
    const window = String(leaf.parameters.window);
    let at = out.length - 1;
    while (at >= 0 && out[at]!.fragment === leaf.fragment && BETWEEN.has(out[at]!.family_id)) at -= 1;
    const host = at >= 0 && out[at]!.fragment === leaf.fragment ? out[at]! : undefined;
    const windowed = host !== undefined && host.family_id === "unit-activity" && Array.isArray(host.parameters.activities) && (host.parameters.activities as string[]).includes(WINDOWED_DESTRUCTION);
    const builtIn = host === undefined ? undefined : setUpWindow(host);
    if (host === undefined || (!windowed && builtIn === undefined) || !sameSentence(sourceText, host.end_byte, leaf.start_byte)) {
      throw new CompileError(`history-window at byte ${leaf.start_byte} names the window of a windowed destruction or a set-up activity before it in its clause, but none precedes it.`);
    }
    if (hosted.has(host)) throw new CompileError(`history-window at byte ${leaf.start_byte}: a history condition takes one window; a second window leaf follows the same one (takes one window).`);
    if (windowed && host.parameters.window !== undefined) throw new CompileError("A windowed destruction names one window.");
    if (builtIn !== undefined && builtIn !== window) throw new CompileError(`history-window ${window} disagrees with the ${builtIn} window the set-up activity already names.`);
    const widened: CompileLeaf = {
      ...host,
      end_byte: Math.max(host.end_byte ?? host.start_byte, leaf.end_byte ?? leaf.start_byte),
      parameters: { ...host.parameters, ...(windowed ? { window } : {}) },
    };
    hosted.add(widened);
    out[at] = widened;
  }
  return out;
}
