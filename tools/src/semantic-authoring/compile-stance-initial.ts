import { CompileError } from "./compile-error.js";
import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * "At the start of the battle, … that unit enters Aegis Protocols (see below). In your Command phase, … select one
 * protocol": a stance-initial leaf names the option of the stance-select-open after it that is in force from the
 * start. It folds onto that opener as `initial_option`, which {@link initialOption} checks against the options.
 */
export function foldStanceInitial(given: readonly CompileLeaf[]): CompileLeaf[] {
  const initials = given.filter((leaf) => leaf.family_id === "stance-initial");
  if (initials.length === 0) return [...given];
  if (initials.length > 1) throw new CompileError("A record names more than one stance in force from the start.");
  const initial = initials[0]!;
  const opener = given.filter((leaf) => leaf.family_id === "stance-select-open" && leaf.start_byte > initial.start_byte)
    .sort((a, b) => a.start_byte - b.start_byte)[0];
  if (opener === undefined) throw new CompileError("stance-initial names a stance, but no stance-select-open follows it.");
  return given.flatMap((leaf) => leaf === initial ? []
    : leaf === opener ? [{ ...leaf, parameters: { ...leaf.parameters, initial_option: initial.parameters.option_id } }] : [leaf]);
}

/** The stance-select's `initial`, when its opener carries one: the id must be one of its options. */
export function initialOption(head: CompileLeaf, options: readonly Node[]): Node {
  const id = head.parameters.initial_option;
  if (id === undefined) return {};
  if (!options.some((option) => option.id === id)) throw new CompileError(`stance-initial names "${String(id)}", which is none of the stance's options (${options.map((option) => String(option.id)).join(", ")}).`);
  return { initial: id };
}
