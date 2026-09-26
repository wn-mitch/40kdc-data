import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { withTransaction } from "./db.js";

/**
 * Sentence vectors for leaf wording, from a small local model. Vectors are unit length, so a dot
 * product is the cosine similarity. They are cached in the workbench database by model and text,
 * and never leave it: they are derived from source wording.
 */

export type Embedder = {
  /** Cache key: a different model never reuses another model's vectors. */
  model: string;
  embed: (texts: readonly string[]) => Promise<Float32Array[]>;
};

export const DEFAULT_EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
const BATCH = 64;

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: true }) => Promise<{ dims: number[]; data: Float32Array }>;

/** The local sentence model, loaded on first use (the weights download once to the model cache). */
export function localEmbedder(model = DEFAULT_EMBEDDING_MODEL): Embedder {
  let loading: Promise<Extractor> | null = null;
  const extractor = () => loading ??= import("@huggingface/transformers")
    .then(({ pipeline }) => pipeline("feature-extraction", model, { dtype: "fp32" }) as unknown as Promise<Extractor>);
  return {
    model,
    async embed(texts) {
      const extract = await extractor();
      const out: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += BATCH) {
        const result = await extract(texts.slice(start, start + BATCH), { pooling: "mean", normalize: true });
        const [rows, width] = result.dims as [number, number];
        for (let row = 0; row < rows; row += 1) out.push(result.data.slice(row * width, (row + 1) * width));
      }
      return out;
    },
  };
}

const textHash = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Vectors for `texts`, in order, embedding only those not yet cached for this model. Returns how
 * many had to be embedded, so callers can report (and tests can pin) cache use.
 */
export async function cachedEmbeddings(db: DatabaseSync, embedder: Embedder, texts: readonly string[]): Promise<{ vectors: Float32Array[]; embedded: number }> {
  const hashes = texts.map(textHash);
  const found = new Map<string, Float32Array>();
  const lookup = db.prepare("SELECT vector FROM text_embeddings WHERE model = ? AND text_hash = ?");
  for (const hash of new Set(hashes)) {
    const row = lookup.get(embedder.model, hash) as { vector: Uint8Array } | undefined;
    if (row) found.set(hash, new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength)));
  }
  const missing = [...new Map(texts.map((text, index) => [hashes[index]!, text])).entries()].filter(([hash]) => !found.has(hash));
  if (missing.length) {
    const vectors = await embedder.embed(missing.map(([, text]) => text));
    if (vectors.length !== missing.length) throw new Error(`The embedder returned ${vectors.length} vectors for ${missing.length} texts.`);
    const insert = db.prepare("INSERT OR REPLACE INTO text_embeddings (model, text_hash, vector) VALUES (?, ?, ?)");
    withTransaction(db, () => missing.forEach(([hash], index) => {
      const vector = vectors[index]!;
      insert.run(embedder.model, hash, new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
      found.set(hash, vector);
    }));
  }
  return { vectors: hashes.map((hash) => found.get(hash)!), embedded: missing.length };
}
