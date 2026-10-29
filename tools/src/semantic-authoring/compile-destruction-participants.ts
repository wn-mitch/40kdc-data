import { CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;


/** A destruction whose following unit-level filter exactly narrows its explicitly named destroyer. */
export function namedDestroyerFilterAfter(event: CompileLeaf | undefined, filter: CompileLeaf | undefined): boolean {
  return event?.family_id === "event" && (event.parameters.kind === "model-destroyed" || event.parameters.kind === "unit-destroyed")
    && filter?.family_id === "unit-filter" && event.fragment === filter.fragment
    && event.parameters.subject_filter === undefined
    && (event.parameters.by === "friendly" || event.parameters.by === "enemy")
    && filter.parameters.side === event.parameters.by && filter.parameters.level !== "model";
}

/**
 * The folded form of `namedDestroyerFilterAfter`: the victim is already the event object, so the
 * following filter can become the exact destroyer subject without displacing it.
 */
export function destroyerFilterAfter(event: CompileLeaf | undefined, filter: CompileLeaf | undefined): boolean {
  return event !== undefined && namedDestroyerFilterAfter(event, filter) && event.parameters.object_filter !== undefined;
}

/** Fold an exact following destroyer filter onto a destruction whose victim is already bound. */
export function foldDestroyerFilter(event: CompileLeaf, filter: CompileLeaf, dslFilter: Node): CompileLeaf {
  if (!destroyerFilterAfter(event, filter)) {
    throw new CompileError("A destruction's following destroyer filter must match its named side after its victim is bound.");
  }
  return { ...event, parameters: { ...event.parameters, subject_filter: dslFilter } };
}
