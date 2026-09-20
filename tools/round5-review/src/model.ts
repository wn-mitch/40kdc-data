import {
  CANDIDATE_VERDICTS,
  type CandidateRow,
  type CandidateSheet,
  type CandidateVerdict,
  type Fingerprint,
  type RecallOccurrence,
  type RecallRow,
  type RecallSheet,
  type SidewaysChoice,
  type ReviewDocument,
} from "./types";
import {
  validateCandidateSheet,
  validateRecallSheet,
  validationMessage,
} from "./schema";


export function parseReviewDocument(value: unknown): ReviewDocument {
  if (validateCandidateSheet(value)) {
    return { kind: "candidate", sheet: value };
  }
  if (validateRecallSheet(value)) {
    return { kind: "recall", sheet: value };
  }
  throw new Error(
    `This is not a valid Round 5 candidate or recall review sheet: ${validationMessage()}`,
  );
}

export function rowsOf(document: ReviewDocument): Array<CandidateRow | RecallRow> {
  return document.sheet.rows;
}

export function isRowComplete(document: ReviewDocument, index: number): boolean {
  const row = rowsOf(document)[index];
  if (!row) return false;
  if (document.kind === "candidate") {
    const candidate = row as CandidateRow;
    return (
      candidate.verdict !== null &&
      CANDIDATE_VERDICTS.includes(candidate.verdict) &&
      Boolean(candidate.batch_id && candidate.confirmer && candidate.confirmed_at)
    );
  }
  const recall = row as RecallRow;
  return (
    typeof recall.contains_hit_semantics === "boolean" &&
    recall.contains_hit_semantics === Boolean(recall.missed_occurrences.length) &&
    Boolean(recall.reviewer && recall.reviewed_at)
  );
}

export function completion(document: ReviewDocument): { completed: number; total: number } {
  const total = rowsOf(document).length;
  let completed = 0;
  for (let index = 0; index < total; index += 1) {
    if (isRowComplete(document, index)) completed += 1;
  }
  return { completed, total };
}

export function nextUnresolved(document: ReviewDocument, current: number, direction = 1): number {
  const total = rowsOf(document).length;
  if (total === 0) return 0;
  for (let offset = 1; offset <= total; offset += 1) {
    const index = (current + direction * offset + total * 2) % total;
    if (!isRowComplete(document, index)) return index;
  }
  return Math.max(0, Math.min(current, total - 1));
}

export function judgeCandidate(
  sheet: CandidateSheet,
  index: number,
  verdict: CandidateVerdict,
  reviewer: string,
  batchId: string,
  confirmedAt: string,
): CandidateSheet {
  if (!reviewer.trim()) throw new Error("Enter an opaque reviewer handle before judging.");
  if (!CANDIDATE_VERDICTS.includes(verdict)) throw new Error(`Unknown verdict: ${verdict}`);
  return {
    ...sheet,
    rows: sheet.rows.map((row, rowIndex) =>
      rowIndex === index
        ? {
            ...row,
            verdict,
            batch_id: batchId,
            confirmer: reviewer.trim(),
            confirmed_at: confirmedAt,
          }
        : row,
    ),
  };
}

export const SIDEWAYS_PROPOSAL_VERSION = "round5b/sideways-proposal/v1";

export type SidewaysProposal = {
  choice: SidewaysChoice;
  reason: string;
};

export function proposeSidewaysMechanic(targetSpan: string): SidewaysProposal {
  const span = targetSpan
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bcritical hit\b.*\b[456]\+|\b[456]\+.*\bcritical hit\b/.test(span)) {
    return { choice: "critical-hit-threshold", reason: "The span explicitly binds a numeric Hit result to a Critical Hit." };
  }
  if (/automatically hits|no hit roll is made/.test(span)) {
    return { choice: "automatic-hit", reason: "The span bypasses the Hit roll and makes the attack hit automatically." };
  }
  if (/re-?roll.*hit rolls?.*(?:of )?1\b/.test(span)) {
    return { choice: "reroll-ones", reason: "The span re-rolls Hit results of 1." };
  }
  if (/re-?roll.*hit rolls?/.test(span)) {
    return { choice: "reroll-all", reason: "The span permits a Hit-roll re-roll without limiting it to results of 1." };
  }
  if (/subtract 1.*hit roll|-1 to .*hit rolls?/.test(span)) {
    return { choice: "modifier-subtract-one", reason: "The span applies a -1 numerical Hit-roll modifier." };
  }
  if (/add 1.*hit roll|\+1 to .*hit rolls?|have \+1 to hit rolls?/.test(span)) {
    return { choice: "modifier-add-one", reason: "The span applies a +1 numerical Hit-roll modifier." };
  }
  if (/ignore.*penalty.*hit rolls?|does not suffer.*penalty.*hit rolls?/.test(span)) {
    return { choice: "modifier-immunity", reason: "The span removes a Hit-roll penalty rather than changing the base modifier." };
  }
  if (/change the result.*hit roll/.test(span)) {
    return { choice: "roll-substitution", reason: "The span replaces or changes a Hit-roll result." };
  }
  if (/fail on.*hit roll|hits? (?:are )?scored on|hit on unmodified hit rolls?|required to score a hit/.test(span)) {
    return { choice: "hit-threshold", reason: "The span changes which results score an ordinary hit." };
  }
  if (/^(?:a |the )?hit rolls?$|making a hit roll|on an? unmodified hit roll/.test(span)) {
    return { choice: "ambiguous", reason: "The isolated span names a Hit roll but does not identify its mechanic." };
  }
  return { choice: "other-hit", reason: "The span contains Hit semantics outside the currently recognized sibling patterns." };
}

function sidewaysVerdict(choice: SidewaysChoice, fingerprint: Fingerprint): CandidateVerdict {
  if (choice === "irrelevant" || choice === "ambiguous") return choice;
  if (choice === "reroll-ones") return fingerprint.family === "reroll" ? "exact-match" : "different-family";
  if (choice === "reroll-all") return fingerprint.family === "reroll" ? "related-variant" : "different-family";
  if (choice === "modifier-add-one") return fingerprint.family === "roll-modifier" ? "exact-match" : "different-family";
  if (choice === "modifier-subtract-one") return fingerprint.family === "roll-modifier" ? "related-variant" : "different-family";
  if (choice === "critical-hit-threshold") {
    return fingerprint.family === "critical-hit-threshold" ? "exact-match" : "different-family";
  }
  return "different-family";
}

export function judgeCandidateSideways(
  sheet: CandidateSheet,
  candidateId: string,
  choice: SidewaysChoice,
  reviewer: string,
  batchId: string,
  confirmedAt: string,
): CandidateSheet {
  if (!reviewer.trim()) throw new Error("Enter an opaque reviewer handle before judging.");
  const representative = sheet.rows.find((row) => row.candidate_id === candidateId);
  if (!representative) throw new Error(`Candidate group is missing: ${candidateId}`);
  const proposal = proposeSidewaysMechanic(representative.target_span);
  const fingerprints = new Map(sheet.fingerprints.map((fingerprint) => [fingerprint.id, fingerprint]));
  return {
    ...sheet,
    assisted: true,
    rows: sheet.rows.map((row) => {
      if (row.candidate_id !== candidateId) return row;
      const fingerprint = fingerprints.get(row.queried_fingerprint_id);
      if (!fingerprint) throw new Error(`Unknown queried fingerprint: ${row.queried_fingerprint_id}`);
      return {
        ...row,
        verdict: sidewaysVerdict(choice, fingerprint),
        batch_id: batchId,
        confirmer: reviewer.trim(),
        confirmed_at: confirmedAt,
        sideways_review: {
          proposal_version: SIDEWAYS_PROPOSAL_VERSION,
          proposed_choice: proposal.choice,
          proposal_reason: proposal.reason,
          confirmed_choice: choice,
          confirmer: reviewer.trim(),
          confirmed_at: confirmedAt,
        },
        retrieval: {
          ...row.retrieval,
          retrieval_method: "sideways-train-proposal",
          version: SIDEWAYS_PROPOSAL_VERSION,
        },
      };
    }),
  };
}

export function clearCandidateGroup(sheet: CandidateSheet, candidateId: string): CandidateSheet {
  return {
    ...sheet,
    rows: sheet.rows.map((row) =>
      row.candidate_id === candidateId
        ? {
            ...row,
            verdict: null,
            batch_id: null,
            confirmer: null,
            confirmed_at: null,
            sideways_review: undefined,
          }
        : row,
    ),
  };
}

export function clearCandidateJudgment(sheet: CandidateSheet, index: number): CandidateSheet {
  return {
    ...sheet,
    rows: sheet.rows.map((row, rowIndex) =>
      rowIndex === index
        ? { ...row, verdict: null, batch_id: null, confirmer: null, confirmed_at: null }
        : row,
    ),
  };
}

export function completeRecall(
  sheet: RecallSheet,
  index: number,
  containsHitSemantics: boolean,
  reviewer: string,
  reviewedAt: string,
): RecallSheet {
  if (!reviewer.trim()) throw new Error("Enter an opaque reviewer handle before judging.");
  const row = sheet.rows[index];
  if (!row) throw new Error("Recall row is missing.");
  if (containsHitSemantics !== Boolean(row.missed_occurrences.length)) {
    throw new Error("A Hit judgment must contain at least one grounded occurrence; No Hit must contain none.");
  }
  return {
    ...sheet,
    rows: sheet.rows.map((candidate, rowIndex) =>
      rowIndex === index
        ? {
            ...candidate,
            contains_hit_semantics: containsHitSemantics,
            reviewer: reviewer.trim(),
            reviewed_at: reviewedAt,
          }
        : candidate,
    ),
  };
}

export function addRecallOccurrence(
  sheet: RecallSheet,
  index: number,
  occurrence: RecallOccurrence,
): RecallSheet {
  if (!occurrence.text) throw new Error("Select the exact source text for the missed occurrence.");
  if (!occurrence.fingerprint.family.trim()) throw new Error("Enter a source-native fingerprint family.");
  const row = sheet.rows[index];
  if (!row) throw new Error("Recall row is missing.");
  const duplicate = row.missed_occurrences.some(
    (existing) =>
      existing.span.start === occurrence.span.start && existing.span.end === occurrence.span.end,
  );
  if (duplicate) throw new Error("That exact occurrence is already recorded.");
  return {
    ...sheet,
    rows: sheet.rows.map((candidate, rowIndex) =>
      rowIndex === index
        ? {
            ...candidate,
            contains_hit_semantics: null,
            reviewer: null,
            reviewed_at: null,
            missed_occurrences: [...candidate.missed_occurrences, occurrence].sort(
              (left, right) => left.span.start - right.span.start,
            ),
          }
        : candidate,
    ),
  };
}

export function removeRecallOccurrence(sheet: RecallSheet, index: number, occurrenceIndex: number): RecallSheet {
  return {
    ...sheet,
    rows: sheet.rows.map((candidate, rowIndex) =>
      rowIndex === index
        ? {
            ...candidate,
            contains_hit_semantics: null,
            reviewer: null,
            reviewed_at: null,
            missed_occurrences: candidate.missed_occurrences.filter((_, itemIndex) => itemIndex !== occurrenceIndex),
          }
        : candidate,

    ),
  };
}
const HIT_CUE_PATTERN =
  String.raw`\bhit(?:s|ting)?\b|\b(?:weapon|ballistic)\s+skill\b|\b(?:WS|BS)\b`;

export type TextRange = {
  start: number;
  end: number;
};

export function hitCueRanges(text: string): TextRange[] {
  return [...text.matchAll(new RegExp(HIT_CUE_PATTERN, "gi"))].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}
export type VimMotion = "h" | "l" | "w" | "b" | "e" | "0" | "$" | "g" | "G";

export function moveVimCursor(text: string, cursor: number, motion: VimMotion): number {
  const current = Math.max(0, Math.min(cursor, text.length));
  if (motion === "h") return Math.max(0, current - 1);
  if (motion === "l") return Math.min(text.length, current + 1);
  if (motion === "g") return 0;
  if (motion === "G") return text.length;
  if (motion === "0") return text.lastIndexOf("\n", Math.max(0, current - 1)) + 1;
  if (motion === "$") {
    const lineEnd = text.indexOf("\n", current);
    return lineEnd === -1 ? text.length : lineEnd;
  }
  if (motion === "e") {
    let end = current;
    while (end < text.length && !/[\p{L}\p{N}_-]/u.test(text[end])) end += 1;
    while (end < text.length && /[\p{L}\p{N}_-]/u.test(text[end])) end += 1;
    return end;
  }
  if (motion === "w") {
    let next = current;
    while (next < text.length && /[\p{L}\p{N}_-]/u.test(text[next])) next += 1;
    while (next < text.length && !/[\p{L}\p{N}_-]/u.test(text[next])) next += 1;
    return next;
  }
  let previous = Math.max(0, current - 1);
  while (previous > 0 && !/[\p{L}\p{N}_-]/u.test(text[previous])) previous -= 1;
  while (previous > 0 && /[\p{L}\p{N}_-]/u.test(text[previous - 1])) previous -= 1;
  return previous;
}

export type HitHintSegment = {
  text: string;
  hit: boolean;
};

export function hitHintSegments(text: string): HitHintSegment[] {
  const pattern = new RegExp(HIT_CUE_PATTERN, "gi");
  const segments: HitHintSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
    segments.push({ text: match[0], hit: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments.length ? segments : [{ text, hit: false }];
}

export function utf8Selection(text: string, start: number, end: number): { start: number; end: number; text: string } {
  if (start < 0 || end < start || end > text.length) throw new Error("Invalid text selection.");
  const encoder = new TextEncoder();
  return {
    start: encoder.encode(text.slice(0, start)).length,
    end: encoder.encode(text.slice(0, end)).length,
    text: text.slice(start, end),
  };
}

export function documentIdentity(document: ReviewDocument): string {
  return document.kind === "candidate"
    ? `${document.sheet.manifest_hash}:${document.sheet.split}`
    : `${document.sheet.manifest_hash}:${document.sheet.audit_hash}`;
}
