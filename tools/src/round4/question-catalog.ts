import type { RelationQuestionType } from "./contracts.js";

export const QUESTION_CATALOG: Readonly<Record<RelationQuestionType, string>> = {
  antecedent: "Resolve one local anaphoric reference to a previously introduced participant.",
  attachment: "Attach one condition or modifier to its local consequence.",
  "branch-kind": "Classify one local branch as conditional, default, exception, or override.",
  "choice-vs-disjunction": "Distinguish deliberate player choice from logical disjunction.",
  "replacement-vs-coexistence": "Distinguish replacement/default semantics from coexisting effects.",
  "iterator-collection": "Resolve the collection traversed by one local iterator.",
  "argument-filling": "Select the source-stated semantic role for one local atom argument.",
  "duration-scope": "Attach one explicit expiry to the local operation or state it governs.",
};
