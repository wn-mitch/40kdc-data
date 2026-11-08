/**
 * Pure DocOp application — used identically by the DocRoom (authoritative)
 * and the clients (optimistic). A failed apply throws WITHOUT mutating the
 * document (validate-then-apply), so the server can reject a batch atomically
 * and a client can hard-resync instead of corrupting local state.
 */
import {
  MAX_OPS_PER_BATCH,
  MAX_PATH_DEPTH,
  type DocOp,
  type PathSeg,
} from "./doc-protocol";

export class OpError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural validation independent of any document. */
export function validateOps(ops: DocOp[]): void {
  if (!Array.isArray(ops) || ops.length === 0) throw new OpError("empty op batch");
  if (ops.length > MAX_OPS_PER_BATCH) throw new OpError("op batch too large");
  for (const op of ops) {
    if (!op || typeof op !== "object" || !Array.isArray((op as { p?: unknown }).p)) {
      throw new OpError("malformed op");
    }
    if (op.p.length > MAX_PATH_DEPTH) throw new OpError("path too deep");
    for (const seg of op.p) {
      const segOk =
        (typeof seg === "string" && seg !== "__proto__" && seg !== "constructor" && seg !== "prototype") ||
        (typeof seg === "number" && Number.isInteger(seg) && seg >= 0);
      if (!segOk) throw new OpError("bad path segment");
    }
    if (op.o === "set") {
      // JSON has no undefined, so a missing value is a malformed op — applying
      // it would drop the key (nested) or blank the whole document (root).
      if (!("v" in op) || op.v === undefined) throw new OpError("set requires a value");
      if (op.p.length === 0) continue; // whole-doc replace is allowed
    } else if (op.o === "del") {
      if (op.p.length === 0) throw new OpError("cannot delete the document root");
    } else if (op.o === "splice") {
      if (
        !Number.isInteger(op.i) ||
        op.i < 0 ||
        !Number.isInteger(op.d) ||
        op.d < 0 ||
        !Array.isArray(op.ins)
      ) {
        throw new OpError("malformed splice");
      }
    } else {
      throw new OpError("unknown op kind");
    }
  }
}

/** Resolve the container holding the path's final segment. Throws when any
 *  intermediate segment is missing or mismatched (ops never create parents —
 *  a missing parent means the doc diverged and the batch must be rejected). */
function resolveParent(doc: unknown, path: PathSeg[]): { parent: unknown; last: PathSeg } {
  let node: unknown = doc;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (typeof seg === "number") {
      if (!Array.isArray(node) || seg >= node.length) throw new OpError("path does not resolve");
      node = node[seg];
    } else {
      if (!isRecord(node) || !(seg in node)) throw new OpError("path does not resolve");
      node = node[seg];
    }
  }
  return { parent: node, last: path[path.length - 1] };
}

/**
 * Apply a batch to `doc`, returning the next document. The input document is
 * never mutated (structural sharing via shallow copies along each op's path),
 * and a throw mid-batch leaves no partial application visible to the caller.
 */
export function applyDocOps(doc: unknown, ops: DocOp[]): unknown {
  validateOps(ops);
  let next = doc;
  for (const op of ops) {
    next = applyOne(next, op);
  }
  return next;
}

function applyOne(doc: unknown, op: DocOp): unknown {
  // Whole-doc replace.
  if (op.o === "set" && op.p.length === 0) return op.v;

  // Copy-on-write along the path so the input doc stays untouched.
  const copy = (node: unknown): unknown =>
    Array.isArray(node) ? [...node] : isRecord(node) ? { ...node } : node;

  function descend(node: unknown, path: PathSeg[]): unknown {
    if (path.length === 1) {
      const seg = path[0];
      if (op.o === "set") {
        if (typeof seg === "number") {
          if (!Array.isArray(node) || seg > node.length) throw new OpError("path does not resolve");
          const arr = [...node];
          arr[seg] = op.v;
          return arr;
        }
        if (!isRecord(node)) throw new OpError("path does not resolve");
        return { ...node, [seg]: op.v };
      }
      if (op.o === "del") {
        if (typeof seg === "number") {
          if (!Array.isArray(node) || seg >= node.length) throw new OpError("path does not resolve");
          const arr = [...node];
          arr.splice(seg, 1);
          return arr;
        }
        if (!isRecord(node) || !(seg in node)) throw new OpError("path does not resolve");
        const obj = { ...node };
        delete obj[seg];
        return obj;
      }
      // splice targets the ARRAY at the full path, handled one level up via
      // resolveParent below — unreachable here.
      throw new OpError("unreachable");
    }
    const seg = path[0];
    if (typeof seg === "number") {
      if (!Array.isArray(node) || seg >= node.length) throw new OpError("path does not resolve");
      const arr = [...node];
      arr[seg] = descend(node[seg], path.slice(1));
      return arr;
    }
    if (!isRecord(node) || !(seg in node)) throw new OpError("path does not resolve");
    return { ...node, [seg]: descend(node[seg], path.slice(1)) };
  }

  if (op.o === "splice") {
    // The path addresses the array itself (possibly the root).
    const target = op.p.length === 0 ? doc : resolveTarget(doc, op.p);
    if (!Array.isArray(target)) throw new OpError("splice target is not an array");
    if (op.i > target.length) throw new OpError("splice index out of range");
    const spliced = [...target];
    spliced.splice(op.i, op.d, ...op.ins);
    if (op.p.length === 0) return spliced;
    return setAtPath(doc, op.p, spliced);
  }

  return descend(doc, op.p);

  function resolveTarget(root: unknown, path: PathSeg[]): unknown {
    const { parent, last } = resolveParent(root, path);
    if (typeof last === "number") {
      if (!Array.isArray(parent) || last >= parent.length) throw new OpError("path does not resolve");
      return parent[last];
    }
    if (!isRecord(parent) || !(last in parent)) throw new OpError("path does not resolve");
    return parent[last];
  }

  function setAtPath(root: unknown, path: PathSeg[], value: unknown): unknown {
    function go(node: unknown, p: PathSeg[]): unknown {
      const seg = p[0];
      if (p.length === 1) {
        if (typeof seg === "number") {
          if (!Array.isArray(node) || seg >= node.length) throw new OpError("path does not resolve");
          const arr = [...node];
          arr[seg] = value;
          return arr;
        }
        if (!isRecord(node)) throw new OpError("path does not resolve");
        return { ...node, [seg]: value };
      }
      if (typeof seg === "number") {
        if (!Array.isArray(node) || seg >= node.length) throw new OpError("path does not resolve");
        const arr = [...node];
        arr[seg] = go(node[seg], p.slice(1));
        return arr;
      }
      if (!isRecord(node) || !(seg in node)) throw new OpError("path does not resolve");
      return { ...node, [seg]: go(node[seg], p.slice(1)) };
    }
    return go(root, path);
  }
}
