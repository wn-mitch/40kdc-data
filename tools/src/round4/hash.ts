import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`);
    return `{${entries.join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Canonical JSON cannot encode undefined");
  return encoded;
}

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashJson(value: unknown): string {
  return sha256Bytes(canonicalize(value));
}

export function hashFile(path: string): string {
  return sha256Bytes(readFileSync(path));
}

export function verifyHash(label: string, expected: string, actual: string): void {
  if (expected !== actual) {
    throw new Error(`${label} hash drift: expected ${expected}, received ${actual}`);
  }
}
