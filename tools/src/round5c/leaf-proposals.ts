import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import { familyRole, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "./contracts.js";
import { prefillFromSource, type PrefillFamily } from "./leaf-prefill.js";
import { withTransaction } from "./db.js";
import { cachedEmbeddings, type Embedder } from "./embeddings.js";
import { mutualKnnClusters, topK, vote } from "./leaf-knn.js";
import { leafBoard, leafSurface } from "./leaves.js";
import { splitPieces, suggestedCuts } from "./split.js";

/**
 * Leaf proposals for wording no leaf covers yet. Decided spellings are the labelled examples;
 * each wording's nearest ones vote on its family, and the closest example of the winning family
 * lends its parameters. Wording too unlike any example is cut where the Split editor would cut
 * it and each piece voted on alone. Everything left is clustered by mutual kNN so a reviewer
 * (or the model) names a group of alike wordings once.
 */

export type ProposalSettings = {
  /** Labelled neighbours consulted per wording. */
  k: number;
  /** A direct proposal needs its nearest example at least this alike… */
  direct_sim: number;
  /** …and at least this share of the neighbours' similarity-weighted vote. */
  direct_share: number;
  /** Mutual-kNN clustering of unlabelled wording: neighbours and minimum similarity. */
  cluster_k: number;
  cluster_sim: number;
};
export const DEFAULT_PROPOSAL_SETTINGS: ProposalSettings = { k: 7, direct_sim: 0.88, direct_share: 0.6, cluster_k: 6, cluster_sim: 0.8 };

export type ProposalPiece = {
  text: string;
  family_id: string;
  family_version: number;
  role: string;
  parameters: Record<string, unknown>;
  /** Vote share times the nearest example's similarity; 1 for a spelling already decided. */
  confidence: number;
  neighbours: Array<{ surface: string; sample_text: string; sim: number }>;
};
/**
 * direct: one leaf for the whole wording. decomposition: every piece has a leaf. partial: some
 * pieces do; deciding them leaves the rest to resurface as its own wording.
 */
export type ProposalKind = "direct" | "decomposition" | "partial" | "llm" | "new-family" | "unlabelled";

/** A piece of a partial decomposition that no example is close enough to name. */
export type UnnamedPiece = { text: string; family_id: null };

type Labelled = { surface: string; text: string; family_id: string; family_version: number; role: string; parameters: Record<string, unknown> };
type Wording = { surface: string; sample_text: string; occurrences: number; closes: number };

/** What the sentence model reads: the wording without the source's bold markers. */
const embedText = (text: string) => text.replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim();

/** Decided spellings and the wording still needing a leaf, straight from the Leaves board. */
function pools(db: DatabaseSync): { labelled: Labelled[]; wordings: Wording[] } {
  const board = leafBoard(db, { limit: Infinity });
  const labelled: Labelled[] = [];
  for (const leaf of board.leaves) {
    if (leaf.retired_version) continue;
    for (const surface of leaf.surfaces) {
      // Only spellings a reviewer decided or annotated; a pending retrieval guess is not a label.
      if (surface.surface_id === null && surface.annotations === 0) continue;
      labelled.push({ surface: surface.surface, text: surface.sample_text, family_id: leaf.family_id, family_version: leaf.family_version, role: leaf.role, parameters: leaf.parameters });
    }
  }
  const decided = new Set(labelled.map((item) => item.surface));
  const wordings = new Map<string, Wording>();
  for (const item of [...board.untiled, ...board.unlabeled]) {
    if (decided.has(item.surface) || wordings.has(item.surface)) continue;
    wordings.set(item.surface, { surface: item.surface, sample_text: item.sample_text, occurrences: item.occurrences, closes: item.unlocks });
  }
  return { labelled, wordings: [...wordings.values()] };
}

type Classified = { piece: ProposalPiece } | { dropped: string } | null;

/** The labelled vote for one text, or null when no example is close and agreed enough. */
function classify(text: string, vector: Float32Array, labelled: readonly Labelled[], vectors: readonly Float32Array[], settings: ProposalSettings): Classified {
  const exact = labelled.find((item) => item.surface === leafSurface(text));
  const neighbours = topK(vector, vectors, settings.k);
  const evidence = neighbours.slice(0, 3).map((item) => ({ surface: labelled[item.index]!.surface, sample_text: labelled[item.index]!.text, sim: Math.round(item.sim * 1000) / 1000 }));
  if (exact) return { piece: { text, family_id: exact.family_id, family_version: exact.family_version, role: exact.role, parameters: exact.parameters, confidence: 1, neighbours: evidence } };
  const result = vote(neighbours, labelled, (item) => item.family_id);
  if (!result || result.best.sim < settings.direct_sim || result.share < settings.direct_share) return null;
  const example = result.best.item;
  try {
    // The example lends its parameters; whatever this wording states outright (a bracketed
    // weapon ability, melee or ranged, "-1", a phase) replaces the example's value.
    const family = REVIEWED_FAMILY_REGISTRY.find((item) => item.id === example.family_id && item.version === example.family_version) as unknown as PrefillFamily | undefined;
    const parameters = normalizeFingerprintParameters(example.family_id, { ...example.parameters, ...prefillFromSource(family, text) }, example.family_version);
    return { piece: { text, family_id: example.family_id, family_version: example.family_version, role: familyRole(example.family_id, example.family_version), parameters,
      confidence: Math.round(result.share * result.best.sim * 1000) / 1000, neighbours: evidence } };
  } catch (error) {
    return { dropped: `${text}: ${example.family_id} parameters from "${example.text}" do not validate (${error instanceof Error ? error.message : String(error)})` };
  }
}

export type ProposalRunCounts = Record<ProposalKind, number> & { clusters: number; embedded: number; labelled: number };

/**
 * Propose leaves for every wording that still needs one, replacing nothing: each run is a new
 * set of rows, and the listing reads the latest finished run. A proposal a reviewer dismissed
 * stays dismissed while a later run proposes the same thing for the same wording.
 */
export async function runLeafProposals(db: DatabaseSync, embedder: Embedder, settings: ProposalSettings = DEFAULT_PROPOSAL_SETTINGS): Promise<{ run_id: number; counts: ProposalRunCounts }> {
  const runId = Number(db.prepare("INSERT INTO leaf_proposal_runs (model, settings_json, status, started_at) VALUES (?, ?, 'running', ?)")
    .run(embedder.model, JSON.stringify(settings), new Date().toISOString()).lastInsertRowid);
  try {
    const counts = await proposeInto(db, runId, embedder, settings);
    db.prepare("UPDATE leaf_proposal_runs SET status = 'finished', counts_json = ?, finished_at = ? WHERE id = ?").run(JSON.stringify(counts), new Date().toISOString(), runId);
    return { run_id: runId, counts };
  } catch (error) {
    db.prepare("UPDATE leaf_proposal_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(error instanceof Error ? error.message : String(error), new Date().toISOString(), runId);
    throw error;
  }
}

async function proposeInto(db: DatabaseSync, runId: number, embedder: Embedder, settings: ProposalSettings): Promise<ProposalRunCounts> {
  const { labelled, wordings } = pools(db);
  const splits = wordings.map((wording) => {
    const words = wording.sample_text.split(/\s+/u).filter(Boolean);
    const pieces = splitPieces(words, suggestedCuts(words));
    return pieces.length > 1 ? pieces : [];
  });
  const pieceTexts = [...new Set(splits.flat())];
  const texts = [...labelled.map((item) => item.text), ...wordings.map((item) => item.sample_text), ...pieceTexts].map(embedText);
  const { vectors, embedded } = await cachedEmbeddings(db, embedder, texts);
  const labelledVectors = vectors.slice(0, labelled.length);
  const wordingVectors = vectors.slice(labelled.length, labelled.length + wordings.length);
  const pieceVectors = new Map(pieceTexts.map((text, index) => [text, vectors[labelled.length + wordings.length + index]!]));

  const clusters = mutualKnnClusters(wordingVectors, settings.cluster_k, settings.cluster_sim);
  const clusterOf = new Map<number, number>();
  clusters.forEach((cluster, index) => cluster.members.forEach((member) => clusterOf.set(member, index)));

  const dismissed = new Set((db.prepare(`SELECT surface, pieces_json FROM leaf_proposals WHERE status = 'dismissed'`).all() as Array<{ surface: string; pieces_json: string }>)
    .map((row) => `${row.surface}\u0000${hashJson(JSON.parse(row.pieces_json))}`));
  const insert = db.prepare(`INSERT INTO leaf_proposals (run_id, cluster, surface, sample_text, kind, pieces_json, confidence, occurrences, closes, dropped_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const counts: ProposalRunCounts = { direct: 0, decomposition: 0, partial: 0, llm: 0, "new-family": 0, unlabelled: 0, clusters: clusters.length, embedded, labelled: labelled.length };

  withTransaction(db, () => {
    wordings.forEach((wording, index) => {
      const dropped: string[] = [];
      const take = (result: Classified): ProposalPiece | null => {
        if (result && "dropped" in result) { dropped.push(result.dropped); return null; }
        return result?.piece ?? null;
      };
      let kind: ProposalKind = "unlabelled";
      let pieces: Array<ProposalPiece | UnnamedPiece> = [];
      // Wording that splits is proposed piece by piece: one leaf for all of it would lose the
      // pieces its nearest example lacks ("… makes an attack" + "that targets a MONSTER").
      const parts = splits[index]!.map((text) => take(classify(text, pieceVectors.get(text)!, labelled, labelledVectors, settings)) ?? { text, family_id: null });
      const named = parts.filter((part): part is ProposalPiece => part.family_id !== null);
      if (named.length) {
        kind = named.length === parts.length ? "decomposition" : "partial";
        pieces = parts;
      } else {
        const whole = take(classify(wording.sample_text, wordingVectors[index]!, labelled, labelledVectors, settings));
        if (whole) {
          kind = "direct";
          pieces = [whole];
        }
      }
      counts[kind] += 1;
      const scores = pieces.filter((piece): piece is ProposalPiece => piece.family_id !== null).map((piece) => piece.confidence);
      const confidence = scores.length ? Math.min(...scores) : 0;
      const status = dismissed.has(`${wording.surface}\u0000${hashJson(pieces)}`) ? "dismissed" : "open";
      insert.run(runId, clusterOf.get(index)!, wording.surface, wording.sample_text, kind, JSON.stringify(pieces), confidence, wording.occurrences, wording.closes, JSON.stringify(dropped), status);
    });
  });
  return counts;
}

export type ListedProposal = {
  id: number; surface: string; sample_text: string; kind: ProposalKind; pieces: Array<ProposalPiece | UnnamedPiece | Record<string, unknown>>;
  confidence: number; occurrences: number; closes: number; dropped: string[];
};
export type ListedCluster = { cluster: number; closes: number; occurrences: number; proposals: ListedProposal[] };
export type ProposalRunView = { id: number; status: string; model: string; counts: ProposalRunCounts | null; error: string | null; started_at: string; finished_at: string | null };
export type ProposalListing = { run: ProposalRunView | null; latest: ProposalRunView | null; clusters: ListedCluster[]; total_clusters: number };

const runView = (row: Record<string, unknown> | undefined): ProposalRunView | null => row ? {
  id: row.id as number, status: row.status as string, model: row.model as string, counts: row.counts_json ? JSON.parse(row.counts_json as string) as ProposalRunCounts : null,
  error: (row.error as string | null) ?? null, started_at: row.started_at as string, finished_at: (row.finished_at as string | null) ?? null,
} : null;

/** The latest run, whether or not it finished. */
export function latestProposalRun(db: DatabaseSync): ProposalRunView | null {
  return runView(db.prepare("SELECT * FROM leaf_proposal_runs ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined);
}

/**
 * Open proposals of the latest finished run, grouped by cluster, for wording that still needs a
 * leaf now (a wording decided or covered since the run drops out). Clusters rank by the sources
 * their wording would finish, then by occurrences.
 */
export function listLeafProposals(db: DatabaseSync, options: { factionId?: string; limit?: number; kinds?: readonly ProposalKind[] } = {}): ProposalListing {
  const run = runView(db.prepare("SELECT * FROM leaf_proposal_runs WHERE status = 'finished' ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined);
  const latest = latestProposalRun(db);
  if (!run) return { run: null, latest, clusters: [], total_clusters: 0 };
  const board = leafBoard(db, { factionId: options.factionId, limit: Infinity });
  const needed = new Map([...board.untiled, ...board.unlabeled].map((item) => [item.surface, item]));
  const clusters = new Map<number, ListedCluster>();
  for (const row of db.prepare("SELECT * FROM leaf_proposals WHERE run_id = ? AND status = 'open' ORDER BY id").all(run.id) as Array<Record<string, unknown>>) {
    const now = needed.get(row.surface as string);
    if (!now) continue;
    const kind = row.kind as ProposalKind;
    if (options.kinds && !options.kinds.includes(kind)) continue;
    const proposal: ListedProposal = {
      id: row.id as number, surface: row.surface as string, sample_text: row.sample_text as string, kind, pieces: JSON.parse(row.pieces_json as string) as ListedProposal["pieces"],
      confidence: row.confidence as number, occurrences: now.occurrences, closes: now.unlocks, dropped: JSON.parse(row.dropped_json as string) as string[],
    };
    const cluster = clusters.get(row.cluster as number) ?? { cluster: row.cluster as number, closes: 0, occurrences: 0, proposals: [] };
    cluster.proposals.push(proposal);
    cluster.closes += proposal.closes;
    cluster.occurrences += proposal.occurrences;
    clusters.set(cluster.cluster, cluster);
  }
  const ranked = [...clusters.values()]
    .map((cluster) => ({ ...cluster, proposals: cluster.proposals.sort((left, right) => right.closes - left.closes || right.occurrences - left.occurrences || left.id - right.id) }))
    .sort((left, right) => right.closes - left.closes || right.occurrences - left.occurrences || left.cluster - right.cluster);
  return { run, latest, clusters: ranked.slice(0, options.limit ?? 80), total_clusters: ranked.length };
}

/** Hide a proposal; a later run proposing the same pieces for the same wording keeps it hidden. */
export function dismissLeafProposal(db: DatabaseSync, id: unknown): { dismissed: number } {
  if (!Number.isSafeInteger(id)) throw new TypeError("A proposal id is required.");
  const result = db.prepare("UPDATE leaf_proposals SET status = 'dismissed' WHERE id = ? AND status = 'open'").run(id as number);
  return { dismissed: Number(result.changes) };
}
