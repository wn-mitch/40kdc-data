/**
 * Canonical Roster JSON serializer — emits the {@link Roster} as 2-space JSON,
 * the same shape the importers consume. This is the lossless pivot, so the
 * pretty-printed text is exactly `roster.schema.json` shape.
 *
 * @packageDocumentation
 */
import type { Roster } from "../import/types.js";
import { prettyJson } from "./helpers.js";
import type { RosterSerializer } from "./serializer.js";

export const rosterJsonSerializer: RosterSerializer = {
  id: "roster-json",
  serialize(roster: Roster): string {
    return prettyJson(roster);
  },
};
