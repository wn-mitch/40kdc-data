/**
 * Parse a Warhammer wargear-option line (army-assist `Datasheets_options.json`
 * `description` prose) into a structured option, or report why it could not.
 *
 * The prose is regular enough to parse with a small staged pipeline:
 *   1. skip non-options (null / "None" / footnotes / "cannot be replaced");
 *   2. peel the leading *constraint* clause ("For every 5 models,", "The
 *      Champion's", "Any number of Boyz", "Up to 2 models", "1 model");
 *   3. split the core on the swap/add verb (passive "… can be replaced with …",
 *      active "… can replace its … with …", or add-on "… equipped with / can
 *      have …") into the replaced weapon(s) and the replacement clause;
 *   4. parse the replacement clause into a flat group or a "one of the
 *      following" choice.
 *
 * Output carries weapon/wargear **display names**, not ids — the converter
 * resolves those against each unit's own wargear (see convert-faction.ts).
 * Anything that does not fit returns `{ ok: false, reason }` so the caller can
 * surface it in the unparsed report rather than guess. Mechanic-only; no
 * copyrighted rules text is reproduced.
 */

export interface ParsedConstraint {
  model_name?: string;
  per_n_models?: number;
  max_count?: number;
  any_number?: boolean;
}

export interface ParsedOption {
  kind: "swap" | "addon";
  constraint: ParsedConstraint;
  /** Display names of weapons removed; empty for a pure add-on. */
  replaces: string[];
  /** Display names added (all of them). Set iff not a choice. */
  replacement?: string[];
  /** Choice of groups ("one of the following"); pick one group. Set iff a choice. */
  replacement_choice?: string[][];
}

export type ParseResult =
  | { ok: true; option: ParsedOption }
  /** A real option we failed to parse — goes to the unparsed report. */
  | { ok: false; reason: string }
  /** Not an option at all (footnote / empty / note) — silently ignored. */
  | { ok: "skip" };

/** Tidy a captured weapon/wargear name: drop footnote markers, collapse spaces. */
function cleanName(raw: string): string {
  return raw
    .replace(/\*+/g, "") // footnote markers ("blastmaster*")
    .replace(/\s+/g, " ")
    .replace(/^[.,;:\s]+|[.,;:\s]+$/g, "")
    .trim();
}

/** Strip a leading per-model quantity ("1 ", "2 ") from a replacement item. */
function stripLeadingCount(item: string): string {
  return cleanName(item.replace(/^\s*\d+\s+/, ""));
}

/** Split a flat replacement/replaces clause on " and " into individual names. */
function splitAnd(clause: string): string[] {
  return clause
    .split(/\s+and\s+/i)
    .map(stripLeadingCount)
    .filter((s) => /[a-z0-9]/i.test(s)); // drop empties and stray punctuation
}

/**
 * Split the concatenated "one of the following" list into groups. The source
 * runs items together with no separator ("1 flamer1 grav-gun1 meltagun"), so we
 * break before each leading count. Each item may itself be "A and B".
 */
function parseChoiceList(tail: string): string[][] {
  // Break before a digit that begins a new item (preceded by a non-digit).
  const parts = tail
    .split(/(?<=\D)(?=\d+\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const groups = parts.map(splitAnd).filter((g) => g.length > 0);
  return groups;
}

/** Parse the text after the swap/add verb into a flat group or a choice. */
function parseReplacement(rest: string): Pick<ParsedOption, "replacement" | "replacement_choice"> {
  const choiceMatch = rest.match(/one of the following\s*:?\s*(.+)$/is);
  if (choiceMatch) {
    const groups = parseChoiceList(choiceMatch[1]);
    // A "choice" that parsed to a single alternative is just a plain
    // replacement — the schema reserves replacement_choice for ≥2 options.
    if (groups.length >= 2) return { replacement_choice: groups };
    if (groups.length === 1) return { replacement: groups[0] };
    return {};
  }
  return { replacement: splitAnd(rest) };
}

/** Normalise known source typos / spacing so the verb regexes match uniformly. */
function normalize(desc: string): string {
  return desc
    .replace(/–|—/g, "-")
    .replace(/replaced\s+with/gi, "replaced with") // collapse double space
    .replace(/can be replace with/gi, "can be replaced with") // missing 'd'
    .replace(/can be replace\b(?! with)/gi, "can be replaced")
    .replace(/replaced one of the following/gi, "replaced with one of the following")
    .replace(/following(?=\d)/gi, "following:") // "following1 flamer" -> "following:1 flamer"
    .replace(/\s+/g, " ")
    .trim();
}

/** Peel the leading constraint clause, returning it plus the remaining core. */
function extractConstraint(core: string): { constraint: ParsedConstraint; rest: string } {
  const constraint: ParsedConstraint = {};
  let s = core;

  const forEvery = s.match(/^for every (\d+) models?(?: in (?:this unit|the unit))?,?\s*/i);
  if (forEvery) {
    constraint.per_n_models = parseInt(forEvery[1], 10);
    s = s.slice(forEvery[0].length);
  }

  if (/^any number of\b/i.test(s)) {
    constraint.any_number = true;
    const m = s.match(/^any number of\s+(.+?)\s+can\b/i);
    if (m && !/^models?$/i.test(m[1])) constraint.model_name = cleanName(m[1]);
    s = s.replace(/^any number of\s+.+?\s+(?=can\b)/i, "");
  } else {
    const upTo = s.match(/^up to (\d+)\s+(.+?)\s+(?=can\b)/i);
    if (upTo) {
      constraint.max_count = parseInt(upTo[1], 10);
      if (!/^models?$/i.test(upTo[2])) constraint.model_name = cleanName(upTo[2]);
      s = s.slice(upTo[0].length);
    } else {
      // "The Champion's …", "The Kill Team Sergeant can …"
      const theRole = s.match(/^the\s+(.+?)(?:'s|’s)\s+/i) || s.match(/^the\s+(.+?)\s+can\b/i);
      if (theRole) {
        constraint.model_name = cleanName(theRole[1]);
        if (constraint.max_count === undefined && constraint.per_n_models === undefined) {
          constraint.max_count = 1;
        }
        // Drop only the "The <role>" lead-in; keep the possessive weapon for the verb stage.
        s = s.replace(/^the\s+/i, "");
      } else {
        // "1 model …", "1 Khorne Berzerker's …", "One model …"
        const leadCount = s.match(/^(\d+|one)\s+(model|.+?)(?=(?:'s|’s)\s+|\s+can\b)/i);
        if (leadCount) {
          const n = /^one$/i.test(leadCount[1]) ? 1 : parseInt(leadCount[1], 10);
          if (constraint.per_n_models === undefined && constraint.max_count === undefined) {
            constraint.max_count = n;
          }
          if (!/^models?$/i.test(leadCount[2])) constraint.model_name = cleanName(leadCount[2]);
          s = s.replace(/^(?:\d+|one)\s+(?:model\s+)?/i, "");
        }
      }
    }
  }

  // A bare "For every N models, 1 <model>'s …" leaves a leading "1 <model>" —
  // and "This model"/"This unit"/"it" lead-ins carry no constraint.
  s = s.replace(/^(\d+)\s+(?=\S+(?:'s|’s)\s)/, "");
  return { constraint, rest: s.trim() };
}

/** Pull the replaced weapon(s) and the replacement clause out of the core. */
function splitOnVerb(
  core: string,
): { replaces: string[]; rest: string } | null {
  // Active voice: "… (can )?(each )?replace(s|d) (its|their|one of its/their) WEAPON with REST"
  const active = core.match(
    /\b(?:can\s+)?(?:each\s+)?replaces?\s+(?:one of\s+)?(?:its|their)\s+(.+?)\s+with\s*:?\s*(.+)$/i,
  );
  if (active) {
    return { replaces: splitAnd(active[1]), rest: active[2].trim() };
  }
  // "have/has (its|their) WEAPON replaced with REST" ("Any number of Boyz can
  // each have their slugga and choppa replaced with …").
  const havePassive = core.match(
    /\b(?:have|has)\s+(?:its|their)\s+(.+?)\s+replaced\s+with\s*:?\s*(.+)$/i,
  );
  if (havePassive) {
    return { replaces: splitAnd(havePassive[1]), rest: havePassive[2].trim() };
  }
  // Passive voice: "… WEAPON can [each] be replaced with REST" (WEAPON sits after
  // a possessive 's, or is the whole lead if none).
  const passive = core.match(/^(.*?)\s+can (?:each )?be replaced\s+with\s*:?\s*(.+)$/i);
  if (passive) {
    const lead = passive[1];
    const possessive = lead.match(/(?:'s|’s)\s+(.+)$/);
    const weapon = possessive ? possessive[1] : lead;
    return { replaces: splitAnd(weapon), rest: passive[2].trim() };
  }
  return null;
}

/** Pull the added wargear out of an add-on core ("equipped with …" / "can have …"). */
function splitOnAddVerb(core: string): { rest: string } | null {
  // Allow an immediate colon ("equipped with:1 lobba") as well as a space.
  const m = core.match(/\b(?:equipped with|can have)\s*:?\s*(.+)$/i);
  return m ? { rest: m[1].trim() } : null;
}

/**
 * Parse one option `description`. Returns `{ ok: "skip" }` for non-options,
 * `{ ok: false, reason }` for a real option we couldn't parse, and
 * `{ ok: true, option }` otherwise.
 */
export function parseOption(description: string | null | undefined): ParseResult {
  if (description == null) return { ok: "skip" };
  const trimmed = description.trim();
  if (trimmed === "" || trimmed === "None") return { ok: "skip" };
  if (trimmed.startsWith("*")) return { ok: "skip" };
  if (/cannot be (replaced|taken|equipped)/i.test(trimmed)) return { ok: "skip" };

  const desc = normalize(trimmed);
  const isSwap = /\breplace/i.test(desc);
  const isAddon = !isSwap && /\b(equipped with|can have)\b/i.test(desc);
  if (!isSwap && !isAddon) {
    return { ok: false, reason: "no swap/add verb recognised" };
  }

  const { constraint, rest: core } = extractConstraint(desc);

  if (isSwap) {
    const split = splitOnVerb(core);
    if (!split) return { ok: false, reason: "could not isolate replaced weapon / replacement" };
    if (split.replaces.length === 0) return { ok: false, reason: "empty replaced-weapon list" };
    const repl = parseReplacement(split.rest);
    if (!repl.replacement?.length && !repl.replacement_choice?.length) {
      return { ok: false, reason: "empty replacement" };
    }
    return { ok: true, option: { kind: "swap", constraint, replaces: split.replaces, ...repl } };
  }

  const add = splitOnAddVerb(core);
  if (!add) return { ok: false, reason: "could not isolate added wargear" };
  const repl = parseReplacement(add.rest);
  if (!repl.replacement?.length && !repl.replacement_choice?.length) {
    return { ok: false, reason: "empty add-on" };
  }
  return { ok: true, option: { kind: "addon", constraint, replaces: [], ...repl } };
}
