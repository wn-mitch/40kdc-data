import type { AtomCandidate, FailureCode, RelationQuestion } from "./contracts.js";

export interface RelationJudgment {
  question_id: string;
  question_type: RelationQuestion["type"];
  selected: string;
  source_span: { start: number; end: number };
}

export interface ComposedNode {
  type: "atom" | "sequence" | "condition" | "choice" | "iteration" | "duration-attachment" | "binding" | "replacement/default-branch";
  atom_id?: string;
  children?: ComposedNode[];
  relation?: RelationJudgment;
}

export interface CompositionResult {
  status: "composed" | "incomplete" | "incoherent";
  roots: ComposedNode[];
  consumed_atom_ids: string[];
  missing_relation_types: RelationQuestion["type"][];
  failures: FailureCode[];
}

function firstOffset(atom: AtomCandidate): number {
  return Math.min(...atom.evidence.map((item) => item.span.start));
}

const CONTAINER_FOR: Readonly<Record<RelationQuestion["type"], ComposedNode["type"]>> = {
  antecedent: "binding",
  attachment: "condition",
  "branch-kind": "condition",
  "choice-vs-disjunction": "choice",
  "replacement-vs-coexistence": "replacement/default-branch",
  "iterator-collection": "iteration",
  "argument-filling": "binding",
  "duration-scope": "duration-attachment",
};

export function composeAtoms(
  atoms: AtomCandidate[],
  questions: RelationQuestion[],
  judgments: RelationJudgment[],
): CompositionResult {
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const judgmentById = new Map(judgments.map((judgment) => [judgment.question_id, judgment]));
  const consumed = new Set<string>();
  const excluded = new Set<string>();
  const failures: FailureCode[] = [];
  const missing = new Set<RelationQuestion["type"]>();
  const relationNodes: ComposedNode[] = [];

  for (const question of questions) {
    const judgment = judgmentById.get(question.id);
    if (!judgment) {
      missing.add(question.type);
      continue;
    }
    if (judgment.selected === "unknown" || judgment.selected === "none") {
      missing.add(question.type);
      continue;
    }
    if (!question.options.some((option) => option.id === judgment.selected)) {
      failures.push("LOCAL_CHOICES_INCOHERENT");
      continue;
    }
    const selected = atomById.get(judgment.selected);
    if (!selected) {
      failures.push(
        question.type === "antecedent" || question.type === "iterator-collection"
          ? "BINDING_ERROR"
          : "ATTACHMENT_ERROR",
      );
      continue;
    }
    consumed.add(selected.id);
    for (const atomId of question.subject_atom_ids) {
      if (atomId !== selected.id) excluded.add(atomId);
    }
    relationNodes.push({
      type: CONTAINER_FOR[question.type],
      children: [{ type: "atom", atom_id: selected.id }],
      relation: judgment,
    });
  }

  const remaining = atoms
    .filter((atom) => !consumed.has(atom.id) && !excluded.has(atom.id))
    .sort((left, right) => firstOffset(left) - firstOffset(right) || left.id.localeCompare(right.id));
  for (const atom of remaining) consumed.add(atom.id);
  const sequence: ComposedNode = {
    type: "sequence",
    children: remaining.map((atom) => ({ type: "atom", atom_id: atom.id })),
  };
  const roots = [sequence, ...relationNodes];
  if (!roots.length) failures.push("ASSEMBLER_ERROR");
  const uniqueFailures = [...new Set(failures)];
  return {
    status: uniqueFailures.includes("LOCAL_CHOICES_INCOHERENT")
      ? "incoherent"
      : missing.size || uniqueFailures.length
        ? "incomplete"
        : "composed",
    roots,
    consumed_atom_ids: [...consumed],
    missing_relation_types: [...missing],
    failures: uniqueFailures,
  };
}
