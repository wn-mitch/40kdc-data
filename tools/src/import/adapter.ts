/**
 * The format-adapter seam.
 *
 * Each supported source format implements {@link FormatAdapter}: it recognises a
 * decoded payload ({@link FormatAdapter.matches}) and lowers it to the
 * format-agnostic {@link ParsedRoster} ({@link FormatAdapter.parse}). Resolution
 * onto 40kdc entity ids happens once, downstream, against any `ParsedRoster` —
 * so adding a new source format (New Recruit, WTC, …) means writing one adapter,
 * not touching the resolver.
 *
 * v1 registers only {@link listForgeAdapter}.
 *
 * @packageDocumentation
 */
import type { ParsedRoster, RosterFormat } from "./types.js";

/** Recognises and parses one source list-export format. */
export interface FormatAdapter {
  /** Stable identifier for the format. Carries through to `Roster.source.format`. */
  id: RosterFormat;
  /** True when this adapter can parse the given decoded payload. */
  matches(decoded: unknown): boolean;
  /** Lower a recognised payload to the format-agnostic intermediate. */
  parse(decoded: unknown): ParsedRoster;
}

/** Pick the first adapter that recognises the payload. */
export function selectAdapter(
  decoded: unknown,
  adapters: FormatAdapter[],
): FormatAdapter {
  const adapter = adapters.find((a) => a.matches(decoded));
  if (!adapter) {
    throw new Error(
      "no registered import adapter recognises this payload " +
        `(tried: ${adapters.map((a) => a.id).join(", ") || "none"})`,
    );
  }
  return adapter;
}
