import type { Node } from "./vocab-conditions.js";

export type { Node };

/** Record-local diagnostics retain the original pointer and never authorize semantic repairs. */
export interface CutoverContext {
  file: string;
  record: string;
  pointer: string;
  faction?: string;
  parentKey?: string;
  parentType?: string;
  unitKeywords?: ReadonlyMap<string, string>;
  report(reason: string, node: unknown, pointer?: string): void;
}
