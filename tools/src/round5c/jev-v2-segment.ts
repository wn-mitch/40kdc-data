import type { DatabaseSync } from "node:sqlite";

import type { LeafRole } from "./contracts.js";
import { getCurrentCoverage } from "./coverage.js";
import { cachedEmbeddings, type Embedder } from "./embeddings.js";
import { topK } from "./leaf-knn.js";
import { leafBoard, leafSurface, untiledRuns } from "./leaves.js";
import { byteTokens } from "./proposal.js";
import { suggestedCuts } from "./split.js";

/**
 * Segmentation for the Jev v2 arm: cut an untiled span into pieces by finding near-matches of
 * already-decided leaf surfaces inside it (sliding windows over byte tokens, scored by the
 * workbench's own embedding cache), filling the gaps between matches with the existing clause
 * splitter and carving out connectives as their own pieces. This is what narrows each piece's
 * choice list in `jev-v2.ts` to the handful of families its nearest decided surfaces belong to,
 * instead of the full active-family registry v1 asks about.
 */

export type DecidedSurface = { surface: string; text: string; family_id: string; family_version: number; role: LeafRole; parameters: Record<string, unknown> };

/** Every currently-decided leaf surface (a reviewer's or the pipeline's own accepted spelling). */
export function decidedSurfaces(db: DatabaseSync): DecidedSurface[] {
  const board = leafBoard(db, { limit: Infinity });
  const result: DecidedSurface[] = [];
  for (const leaf of board.leaves) {
    if (leaf.retired_version) continue;
    for (const surface of leaf.surfaces) {
      // Same "is this actually decided" filter leaf-proposals.ts's pools() uses.
      if (surface.surface_id === null && surface.annotations === 0) continue;
      result.push({ surface: surface.surface, text: surface.sample_text, family_id: leaf.family_id, family_version: leaf.family_version, role: leaf.role as LeafRole, parameters: leaf.parameters });
    }
  }
  return result;
}

const CONNECTIVES = new Set(["and", "or", "then", "if", "while", "unless", "until", "as", "well"]);
const MAX_WINDOW = 10;
const MIN_WINDOW = 2;
/** What the sentence model reads: bare words, no source bold markers (matches leaf-proposals.ts). */
const embedText = (text: string) => text.replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim();

export type SegmentPiece = {
  start_byte: number;
  end_byte: number;
  text: string;
  kind: "matched" | "gap" | "connective";
  matched_surface: DecidedSurface | null;
  match_score: number | null;
};

type Token = { start: number; end: number; text: string };

/** Word tokens (punctuation dropped) for one span, with absolute byte offsets. */
function wordTokens(spanText: string, baseByte: number): Token[] {
  return byteTokens(spanText)
    .filter(([, , text]) => /[\p{L}\p{N}]/u.test(text))
    .map(([start, end, text]) => ({ start: start + baseByte, end: end + baseByte, text }));
}

/** Every window (MIN_WINDOW..MAX_WINDOW tokens, none of them a connective) this span could match. */
function candidateWindows(tokens: readonly Token[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (let len = Math.min(MAX_WINDOW, tokens.length - i); len >= MIN_WINDOW; len -= 1) {
      const slice = tokens.slice(i, i + len);
      if (slice.some((token) => CONNECTIVES.has(token.text.toLowerCase()))) continue;
      out.push(slice.map((token) => token.text).join(" "));
    }
  }
  return out;
}

/** Group consecutive gap tokens and cut each group the way the Split editor / leaf-proposals.ts
 * do — `suggestedCuts`/index-based slicing, so gap pieces line up with the existing splitter's
 * notion of where composed wording divides. */
function gapPieces(tokens: readonly Token[]): SegmentPiece[] {
  if (tokens.length === 0) return [];
  const words = tokens.map((token) => token.text);
  const cuts = [...suggestedCuts(words)].sort((a, b) => a - b);
  const bounds = [...cuts, tokens.length];
  const pieces: SegmentPiece[] = [];
  let start = 0;
  for (const bound of bounds) {
    if (bound > start) {
      const slice = tokens.slice(start, bound);
      pieces.push({
        start_byte: slice[0]!.start, end_byte: slice.at(-1)!.end, text: slice.map((token) => token.text).join(" "),
        kind: "gap", matched_surface: null, match_score: null,
      });
    }
    start = bound;
  }
  return pieces;
}

export type SegmentationOptions = { threshold: number };

/**
 * Segment one span. `decided`/`decidedVectors` must be index-aligned (same order); `vectorOf`
 * resolves a candidate window's own embedding, from a batch this span's caller already fetched.
 */
function segmentTokens(
  tokens: readonly Token[], decided: readonly DecidedSurface[], decidedVectors: readonly Float32Array[],
  vectorOf: (text: string) => Float32Array | undefined, options: SegmentationOptions,
): SegmentPiece[] {
  const pieces: SegmentPiece[] = [];
  let gap: Token[] = [];
  const flushGap = () => { pieces.push(...gapPieces(gap)); gap = []; };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (CONNECTIVES.has(token.text.toLowerCase())) {
      flushGap();
      pieces.push({ start_byte: token.start, end_byte: token.end, text: token.text, kind: "connective", matched_surface: null, match_score: null });
      i += 1;
      continue;
    }
    let matchLen = 0;
    let matchSurface: DecidedSurface | null = null;
    let matchScore = 0;
    for (let len = Math.min(MAX_WINDOW, tokens.length - i); len >= MIN_WINDOW; len -= 1) {
      const slice = tokens.slice(i, i + len);
      if (slice.some((t) => CONNECTIVES.has(t.text.toLowerCase()))) continue;
      const windowText = slice.map((t) => t.text).join(" ");
      const normalized = leafSurface(windowText);
      const exact = decided.find((candidate) => candidate.surface === normalized);
      if (exact) { matchLen = len; matchSurface = exact; matchScore = 1; break; }
      const vector = vectorOf(embedText(windowText));
      if (!vector || decidedVectors.length === 0) continue;
      const [best] = topK(vector, decidedVectors, 1);
      if (best && best.sim >= options.threshold) { matchLen = len; matchSurface = decided[best.index]!; matchScore = best.sim; break; }
    }
    if (matchLen > 0 && matchSurface) {
      flushGap();
      const slice = tokens.slice(i, i + matchLen);
      pieces.push({
        start_byte: slice[0]!.start, end_byte: slice.at(-1)!.end, text: slice.map((t) => t.text).join(" "),
        kind: "matched", matched_surface: matchSurface, match_score: matchScore,
      });
      i += matchLen;
    } else {
      gap.push(token);
      i += 1;
    }
  }
  flushGap();
  return pieces.sort((left, right) => left.start_byte - right.start_byte);
}

/** Segment every given span against the workbench's decided surfaces, batching every candidate
 * window's embedding (plus the decided surfaces themselves) into one `cachedEmbeddings` call. */
export async function segmentSpans(
  db: DatabaseSync, embedder: Embedder, spans: ReadonlyArray<{ text: string; start_byte: number }>, options: SegmentationOptions,
): Promise<SegmentPiece[][]> {
  const decided = decidedSurfaces(db);
  const spanTokens = spans.map((span) => wordTokens(span.text, span.start_byte));
  const windowTexts = new Set<string>();
  for (const tokens of spanTokens) for (const window of candidateWindows(tokens)) windowTexts.add(embedText(window));
  const decidedTexts = decided.map((surface) => embedText(surface.text));
  const allTexts = [...decidedTexts, ...windowTexts];
  const { vectors } = await cachedEmbeddings(db, embedder, allTexts);
  const decidedVectors = vectors.slice(0, decided.length);
  const windowVectorByText = new Map<string, Float32Array>();
  [...windowTexts].forEach((text, index) => windowVectorByText.set(text, vectors[decided.length + index]!));
  const vectorOf = (text: string) => windowVectorByText.get(text);
  return spanTokens.map((tokens) => segmentTokens(tokens, decided, decidedVectors, vectorOf, options));
}

/**
 * Calibrate the match threshold against already-tiled abilities: mask each one's decided leaf
 * spans as if they were untiled, re-segment, and measure how often the resulting cut boundaries
 * (not the label — just where a piece starts and ends) land exactly on a real leaf span boundary.
 */
export type CalibrationResult = {
  threshold: number;
  abilities_sampled: number;
  true_boundaries: number;
  predicted_boundaries: number;
  matched_boundaries: number;
  precision: number;
  recall: number;
  f1: number;
};

function tiledCalibrationSample(db: DatabaseSync, embedder: Embedder, maxAbilities: number) {
  const coverage = getCurrentCoverage(db);
  const rows = db.prepare(`SELECT id, source_text FROM abilities WHERE current = 1`).all() as Array<{ id: number; source_text: string }>;
  type Sample = { text: string; start_byte: number; trueBoundaries: Set<string> };
  const samples: Sample[] = [];
  for (const row of rows) {
    if (samples.length >= maxAbilities) break;
    const view = coverage.get(row.id);
    if (!view || untiledRuns(view).length > 0) continue; // only fully-tiled abilities are ground truth
    const spans = db.prepare(`
      SELECT source_spans.start_byte, source_spans.end_byte FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
      WHERE annotations.status = 'active' AND source_spans.ability_version_id = ?
      ORDER BY source_spans.start_byte
    `).all(row.id) as Array<{ start_byte: number; end_byte: number }>;
    if (spans.length < 2) continue; // need at least one real internal boundary to be informative
    const trueBoundaries = new Set<string>();
    for (const span of spans) { trueBoundaries.add(String(span.start_byte)); trueBoundaries.add(String(span.end_byte)); }
    samples.push({ text: row.source_text, start_byte: 0, trueBoundaries });
  }
  return samples;
}

export async function calibrateThreshold(
  db: DatabaseSync, embedder: Embedder, options: { thresholds?: readonly number[]; maxAbilities?: number } = {},
): Promise<CalibrationResult[]> {
  const thresholds = options.thresholds ?? [0.75, 0.8, 0.85, 0.9, 0.95];
  const samples = tiledCalibrationSample(db, embedder, options.maxAbilities ?? 40);
  const results: CalibrationResult[] = [];
  for (const threshold of thresholds) {
    const segmented = await segmentSpans(db, embedder, samples, { threshold });
    let truePos = 0;
    let predicted = 0;
    let actual = 0;
    segmented.forEach((pieces, index) => {
      const sample = samples[index]!;
      actual += sample.trueBoundaries.size;
      const predictedBoundaries = new Set<string>();
      for (const piece of pieces) { predictedBoundaries.add(String(piece.start_byte)); predictedBoundaries.add(String(piece.end_byte)); }
      predicted += predictedBoundaries.size;
      for (const boundary of predictedBoundaries) if (sample.trueBoundaries.has(boundary)) truePos += 1;
    });
    const precision = predicted > 0 ? truePos / predicted : 0;
    const recall = actual > 0 ? truePos / actual : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    results.push({ threshold, abilities_sampled: samples.length, true_boundaries: actual, predicted_boundaries: predicted, matched_boundaries: truePos, precision, recall, f1 });
  }
  return results;
}
