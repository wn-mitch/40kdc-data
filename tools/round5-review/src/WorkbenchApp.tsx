import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LeafStampVariant, StampApprovalEligibility, StampChallengeState, StampDefinition, StampEvidenceReference, StampGuard, StampTemplate } from "../../src/round5c/contracts";

import { utf8Selection } from "./model";
import { api, readable } from "./workbench-api";
import { SourceWorkPanel, type SourceWorkAbility } from "./SourceWorkPanel";
import { OntologyPanel } from "./OntologyPanel";
import { CompositionQueuePanel } from "./CompositionQueuePanel";
import "./workbench.css";

type Role = "EFFECT" | "DURATION" | "EVENT" | "CONDITION";
type View = "queue" | "compose" | "abilities" | "family" | "ontology" | "frontier" | "stamps" | "drafts" | "work" | "dashboard" | "luna";
type Action = "confirm" | "correct" | "reject" | "novel" | "ambiguous" | "confirm-connective";
type Fragment = { fragment: string; start_byte: number; end_byte: number; text: string };
type Span = {
  id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string;
  role: string; family_id: string | null; family_version: number | null;
  parameters: Record<string, unknown> | null; origin: string;
};
type Annotation = Span & {
  span_id: number;
  confirmed_by: string;
  authority_kind: "human" | "stamp";
  rule_authorized_by: string | null;
};
type Proposal = Span & { reason: unknown; score: number | null; status: string };
type Ability = {
  id: number; current: boolean; faction_id: string; ability_id: string; source_hash: string; review_evidence_hash: string; source_text: string;
  source_type: string | null; source_kind: string | null; name: string | null;
  fragments: Fragment[]; annotations: Annotation[]; proposals: Proposal[];
  coverage: SourceWorkAbility["coverage"] & { proposal_fraction: number; whole_reviewed: boolean; uncovered: Fragment[]; unaccounted: Fragment[]; residue: Fragment[] };
  progress: LeafProgress;
  atoms: SourceWorkAbility["atoms"];
  composition_escalation_id: string | null;
  review: { whole_context_checked: boolean; source_shape: string | null; cues: Record<string, unknown>; reviewed_by: string | null } | null;
  context: {
    owners: { unit_id: string; name: string | null; role: string | null }[];
    wargear: { id: string; name: string | null; options: { id: string; model_constraint: Record<string, unknown> | null }[] } | null;
    selection_budgets: { unit_id: string; count: number; per_models: number }[];
    existing_dsl: { provenance: string; effect: Record<string, unknown> | null; scope: Record<string, unknown> | null; game_version: Record<string, unknown> | null } | null;
  };
};
type AbilityPage = { items: Ability[]; next_cursor: string | null };
type LeafProgress = {
  leaves: { family_id: string; authority_kind: string; count: number }[];
  connective_bytes: number; pending_proposals: number; unresolved_proposals: number;
  open_leaf_gaps: number; residue_regions: number; residue_bytes: number; composition_ready: boolean;
  readiness: SourceWorkAbility["progress"]["readiness"];
};
type QueueTarget =
  | { view: "family"; family_id: string; signature: string }
  | { view: "stamps"; stamp_id: string; revision: number }
  | { view: "abilities"; ability_version_id: number; source_hash?: string; action?: "analyze-source" | "whole-context" }
  | { view: "work"; escalation_id: string }
  | { view: "luna"; mode: "residue"; faction_id: string | null };
type QueueItem = { key: string; kind: string; unlocks: number; backlog: number; why: string; target: QueueTarget };
type WorkQueue = { items: QueueItem[]; total: number; thresholds: { multi_yield: number; group_page: number } };
type LunaMode = "coverage" | "residue";
type UncoveredSelection = Fragment & { ability_version_id: number; source_hash: string; ability_id: string; faction_id: string };
type ParameterProperty = { enum?: string[]; anyOf?: Array<{ enum?: string[]; type?: string; const?: string }>; type?: string };
type ReviewedFamily = {
  id: string; version: number; role: Role; label: string; description: string;
  starter: Record<string, unknown>;
  parameterSchema: { properties?: Record<string, ParameterProperty> };
};
type Decision = {
  action: Action; proposal_id?: number; supersedes_annotation_id?: number; ability_version_id: number; source_hash: string;
  fragment: string; start_byte: number; end_byte: number; exact_text: string; role: string;
  family_id?: string; family_version?: number; parameters?: Record<string, unknown>; allow_overlap?: boolean;
};
type Draft = {
  ability_id: number; source_hash: string; fragment: string; start: string; end: string;
  role: string; family: string; version: string; parameters: string; overlap: boolean;
  span?: Span; kind: "selection" | "annotation" | "proposal";
};
type Occurrence = {
  proposal_id: number; origin: string; ability_version_id: number; faction_id: string; ability_id: string; source_hash: string;
  fragment: string; start_byte: number; end_byte: number; exact_text: string; context: string; context_signature: string; context_start: number; context_end: number; score: number | null;
  fingerprint_id: string; family_id: string; family_version: number; role: string; parameters: Record<string, unknown>;
};
type FamilyGroup = { signature: string; count: number; context_count: number; samples: string[]; stamp_seed_annotation_id: number | null; occurrences: Occurrence[] };
type FamilyPage = { groups: FamilyGroup[]; next_cursor: string | null; progress: { reviewed: number; total: number } };
type Frontier = {
  clusters: { signature: string; count: number; samples: { ability_version_id: number; source_hash: string; fragment: string; start_byte: number; end_byte: number; exact_text: string }[] }[];
  conflicts: { proposal_id: number; ability_version_id: number; reason: unknown }[];
  abilities: { id: number; faction_id: string; ability_id: string; leaf_fraction: number }[];
};
type PreparedRun = { run_id: string; input_hash: string; request: unknown };
type WorkPurpose = "propose-rule" | "challenge-rule" | "verify-draft";
type StampIdentity = { id: string; revision: number };
/** Stamp writes return `{stamp_id, revision}`; the UI selects stamps by `{id, revision}`. */
const stampIdentity = (result: { stamp_id: string; revision: number }): StampIdentity => ({ id: result.stamp_id, revision: result.revision });
type StampRecord = StampIdentity & {
  kind: "leaf" | "composition";
  status: "proposed" | "approved" | "rejected" | "suspended" | "superseded";
  definition_hash: string;
  definition: StampDefinition;
  model_run_id: number | null;
  challenge_run_id: number | null;
  updated_at: string;
};
type StampDetail = StampRecord & {
  positives: StampEvidenceReference[];
  counterexamples: StampEvidenceReference[];
  challenge: Record<string, unknown> | null;
  approval_eligibility: StampApprovalEligibility;
};
type StampPage = { items: StampRecord[]; next_cursor: string | null; total: number };
type StampPreview = {
  stamp_id: string;
  revision: number;
  definition_hash: string;
  preview_hash: string;
  totals: { eligible: number; already_satisfied: number; blocked: number };
  parameter_combinations: Array<Record<string, unknown>>;
  examples: Array<{
    occurrence_id: string; ability_version_id: number; source_hash: string; fragment: string;
    start_byte: number; end_byte: number; exact_text: string; variant_id: string;
    bindings: Record<string, unknown>; output: unknown; status: string; reason_code: string | null;
  }>;
  counterexamples: unknown[];
  dependent_drafts: string[];
  next_cursor: string | null;
};
type StampAuditItem = {
  application_id: string;
  inputs_hash: string;
  variant_id: string;
  bindings: Record<string, unknown>;
  dependencies: Record<string, unknown>;
  dependency_hash: string;
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  neighboring_context: { before: string; after: string; signature: string };
  strata: string[];
  latest_audit: {
    verdict: "correct" | "incorrect" | "uncertain";
    scope: "occurrence" | "rule" | null;
    reviewer: string;
    created_at: string;
  } | null;
};
type StampAuditPage = {
  stamp_id: string;
  revision: number;
  audit_hash: string;
  items: StampAuditItem[];
  coverage: {
    applications: number;
    selected: number;
    strata: number;
    variants: { observed: number; represented: number };
    enum_combinations: { observed: number; represented: number };
    numeric_extrema: { observed: number; represented: number };
    neighboring_contexts: { observed: number; represented: number };
    additional: number;
  };
  next_cursor: string | null;
};
type StampAuditResult = {
  audit_id: string;
  batch_id: string;
  correction: {
    ability_version_id: number;
    fragment: string;
    start_byte: number;
    end_byte: number;
    exact_text: string;
  } | null;
  affected_published_entries: Array<{
    publication_batch_id: string;
    faction_id: string;
    ability_id: string;
    draft_id: string;
  }>;
};
type Escalation = {
  id: string;
  reason_code: string;
  state: "open" | "deferred" | "resolved";
  occurrence_count: number;
  assemblable_abilities: number | null;
  evidence_hash: string;
  question: Record<string, unknown>;
  options: unknown;
  updated_at: string;
  sources: Array<{ ability_version_id: number; faction_id: string; ability_id: string; name: string | null; source_text: string; span_text: string | null }>;
};
type EscalationPage = { items: Escalation[]; next_cursor: string | null; total: number };
type AssemblyDraft = {
  id: string;
  status: "proposed" | "accepted" | "blocked" | "stale";
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  stamp_id: string;
  stamp_revision: number;
  rendered_text: string | null;
  graph: Record<string, unknown>;
  mechanics: Record<string, unknown> | null;
  diagnostic: Record<string, unknown>;
  verifier_run_id: number | null;
  updated_at: string;
};
type DraftDetail = AssemblyDraft & {
  source_text: string;
  dependencies: Record<string, unknown>;
  publication: { prepare: string; publish: string; latest_batch: { batch_id: string; state: string; preview_hash: string; relative_path: string | null; receipt: unknown } | null } | null;
};
type DraftPage = { items: AssemblyDraft[]; next_cursor: string | null; total: number };
type PreparedWork = PreparedRun & {
  request_path: string;
  reused: boolean;
  status: "pending" | "completed" | "failed";
  oversized: Array<Record<string, unknown>>;
};
type WorkJob = { run_id: string; state: "running" | "completed" | "failed"; started_at: string; finished_at: string | null; report: WorkImportReport | null; error: string | null };
type WorkImportReport = {
  run_id: string;
  imported: number;
  stale: number;
  failed: number;
  items: Array<{ item_id: string; status: "imported" | "stale" | "failed"; reason: string }>;
};

const ROLES: Role[] = ["EFFECT", "DURATION", "EVENT", "CONDITION"];
const ROLE_LABELS: Record<Role, string> = {
  EFFECT: "Effect: what changes", DURATION: "Duration: how long",
  EVENT: "Event: when it fires", CONDITION: "Condition: when it applies",
};
const CHARACTERISTICS = ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"];
const REVIEWER = "local-reviewer";
const VIEWS: { id: View; label: string }[] = [
  { id: "queue", label: "Next up" },
  { id: "compose", label: "Ready for composition" },
  { id: "abilities", label: "Abilities" },
  { id: "family", label: "Family mode" },
  { id: "ontology", label: "Provisional families" },
  { id: "frontier", label: "Frontier" },
  { id: "stamps", label: "Stamps" },
  { id: "drafts", label: "Drafts" },
  { id: "work", label: "Model work" },
  { id: "dashboard", label: "Coverage" },
  { id: "luna", label: "Luna batches" },
];
const QUEUE_KIND_LABELS: Record<string, string> = {
  conflict: "Conflict", composition: "Compose reviewed source", "family-group": "Family group", stamp: "Leaf stamp", "unresolved-cluster": "Unresolved wording",
  "broad-seed": "Narrow a seed", luna: "Hand to Luna", ability: "Ability card",
  "unparsed-source": "Untouched source", "whole-context-check": "Whole-context check",
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const percent = (value: number) => `${Math.round(value * 100)}%`;
const overlaps = (left: { start_byte: number; end_byte: number }, right: { start_byte: number; end_byte: number }) => left.start_byte < right.end_byte && right.start_byte < left.end_byte;
const pending = (proposal: Proposal) => proposal.status === "pending" || proposal.status === "unresolved";
const uncoveredKey = (item: UncoveredSelection) => `${item.ability_version_id}:${item.source_hash}:${item.fragment}:${item.start_byte}:${item.end_byte}`;
const choicesFor = (property: ParameterProperty) => property.enum ?? property.anyOf?.find((item) => item.enum)?.enum ?? [];
function parameterReady(value: unknown, property: ParameterProperty, exactText: string): boolean {
  if (choicesFor(property).includes(String(value))) return true;
  if (Number.isSafeInteger(value) && (property.type === "integer" || property.anyOf?.some((item) => item.type === "integer"))) return true;
  if ((property.type === "object" || property.anyOf?.some((item) => item.type === "object"))
    && value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 1 && "source" in value && typeof value.source === "string"
    && value.source.length > 0 && exactText.includes(value.source)) return true;
  return property.anyOf?.some((item) => item.const === value) ?? false;
}
function dslLeafPreview(family: string, params: Record<string, unknown>): Record<string, unknown> | null {
  const target = params.subject === "bearer" ? "bearer" : params.subject === "this-model" ? "self" : params.subject === "this-unit" ? "unit" : null;
  if (family === "weapon-ability-grant" && target && typeof params.keyword === "string" && params.keyword) {
    return { type: "keyword-grant", target, modifier: { keywords: [params.keyword], scope: "weapon" } };
  }
  if (family !== "characteristic-set" || typeof params.value !== "number" || typeof params.characteristic !== "string") return null;
  return target ? { type: "stat-modifier", target, modifier: { stat: params.characteristic, operation: "set", value: params.value } } : null;
}

function parameters(value: string): Record<string, unknown> {
  const result: unknown = JSON.parse(value);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Parameters and cues must be JSON objects.");
  return result as Record<string, unknown>;
}

function sourceSlice(ability: Ability, fragment: string, start: number, end: number): string {
  const boundary = ability.fragments.find((item) => item.fragment === fragment);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !boundary || start < boundary.start_byte || end > boundary.end_byte || end <= start) {
    throw new Error("Use a nonempty byte range entirely inside the selected source fragment.");
  }
  try { return decoder.decode(encoder.encode(ability.source_text).subarray(start, end)); }
  catch { throw new Error("A boundary splits a UTF-8 character. Select whole characters in the source."); }
}

function spanDraft(ability: Ability, span: Span, kind: Draft["kind"]): Draft {
  return {
    ability_id: ability.id, source_hash: ability.source_hash, fragment: span.fragment,
    start: String(span.start_byte), end: String(span.end_byte), role: span.role,
    family: span.family_id ?? "", version: String(span.family_version ?? 1),
    parameters: JSON.stringify(span.parameters ?? {}, null, 2), overlap: false, span, kind,
  };
}

function proposalDecision(ability: Ability, proposal: Proposal, action: Action): Decision {
  return {
    action, proposal_id: proposal.id, ability_version_id: ability.id, source_hash: ability.source_hash,
    fragment: proposal.fragment, start_byte: proposal.start_byte, end_byte: proposal.end_byte,
    exact_text: proposal.exact_text, role: proposal.role,
    ...(proposal.family_id ? { family_id: proposal.family_id, family_version: proposal.family_version ?? 1, parameters: proposal.parameters ?? {} } : {}),
  };
}

function SourceFragment({ ability, fragment, active, inspect, select }: {
  ability: Ability; fragment: Fragment; active: Draft | null;
  inspect: (ability: Ability, span: Span, kind: Draft["kind"]) => void;
  select: (ability: Ability, fragment: Fragment, start: number, end: number, text: string) => void;
}) {
  const root = useRef<HTMLParagraphElement>(null);
  const segments = useMemo(() => {
    const paints = [
      ...ability.annotations.map((span) => ({ span, kind: "annotation" as const })),
      ...ability.proposals.filter(pending).map((span) => ({ span, kind: "proposal" as const })),
    ].filter(({ span }) => span.fragment === fragment.fragment);
    const bounds = new Set([fragment.start_byte, fragment.end_byte]);
    for (const { span } of paints) {
      if (span.start_byte >= fragment.start_byte && span.end_byte <= fragment.end_byte) {
        bounds.add(span.start_byte); bounds.add(span.end_byte);
      }
    }
    const bytes = encoder.encode(ability.source_text);
    const activeStart = Number(active?.start);
    const activeEnd = Number(active?.end);
    if (active?.ability_id === ability.id && active.fragment === fragment.fragment
      && Number.isSafeInteger(activeStart) && Number.isSafeInteger(activeEnd)
      && activeStart >= fragment.start_byte && activeEnd <= fragment.end_byte && activeEnd > activeStart) {
      try {
        decoder.decode(bytes.subarray(fragment.start_byte, activeStart));
        decoder.decode(bytes.subarray(activeStart, activeEnd));
        bounds.add(activeStart); bounds.add(activeEnd);
      } catch { /* Invalid manual byte boundaries are reported in the editor, not painted. */ }
    }
    const points = [...bounds].sort((a, b) => a - b);
    return points.slice(0, -1).map((start, index) => {
      const end = points[index + 1];
      return { start, end, text: decoder.decode(bytes.subarray(start, end)), paints: paints.filter(({ span }) => span.start_byte <= start && span.end_byte >= end) };
    });
  }, [ability, fragment, active?.ability_id, active?.fragment, active?.start, active?.end, active?.role, active?.family]);

  function capture() {
    const selection = window.getSelection();
    if (!root.current || !selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!root.current.contains(range.startContainer) || !root.current.contains(range.endContainer)) return;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(root.current);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const found = utf8Selection(fragment.text, start, start + range.toString().length);
    select(ability, fragment, fragment.start_byte + found.start, fragment.start_byte + found.end, found.text);
  }

  return <section id={`wb-fragment-${ability.id}-${fragment.fragment}`} className="wb-fragment" aria-label={`${fragment.fragment} source fragment`}>
    <div className="wb-fragment-label"><span>{fragment.fragment}</span><span>bytes {fragment.start_byte}–{fragment.end_byte}</span></div>
    <p ref={root} className="wb-source" tabIndex={0} aria-label={`${fragment.fragment} complete source. Select text to annotate.`}
      onMouseUp={capture} onKeyUp={(event) => { if (event.key === "Shift" || event.shiftKey) capture(); }}>
      {segments.map((segment) => {
        const paint = segment.paints[0];
        const selected = active?.ability_id === ability.id && active.fragment === fragment.fragment && Number(active.start) <= segment.start && Number(active.end) >= segment.end;
        const role = (paint?.span.family_id === "resource-action" || (!paint && active?.family === "resource-action")) ? "resource" : (paint?.span.role ?? active?.role ?? "EFFECT").toLowerCase();
        if (!paint) return selected
          ? <span key={segment.start} className={`wb-paint wb-role-${role} wb-proposal wb-selected wb-draft-preview`}>{segment.text}</span>
          : <span key={segment.start} className="wb-unpainted">{segment.text}</span>;
        return <span key={segment.start} role="button" tabIndex={0}
          className={`wb-paint wb-role-${role} wb-${paint.kind}${selected ? " wb-selected" : ""}`}
          title={`${paint.kind === "annotation" ? paint.span.authority_kind === "stamp" ? "Rule-derived" : "Confirmed" : "Unconfirmed proposal"}: ${paint.span.role}, ${paint.span.family_id ?? "unresolved"}. Bytes ${segment.start}–${segment.end}${segment.paints.length > 1 ? ". Multiple overlapping spans; use the inspector list." : ""}`}
          onClick={() => { if (window.getSelection()?.isCollapsed !== false) inspect(ability, paint.span, paint.kind); }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspect(ability, paint.span, paint.kind); } }}>
          {segment.text}
        </span>;
      })}
    </p>
  </section>;
}

function ReviewCensus({ ability, disabled, save, onDirtyChange }: { ability: Ability; disabled: boolean; save: (checked: boolean, shape: string, cues: string, expectedReviewHash: string) => void; onDirtyChange: (id: number | null) => void }) {
  const [shape, setShape] = useState(ability.review?.source_shape ?? "");
  const [cues, setCues] = useState(JSON.stringify(ability.review?.cues ?? {}, null, 2));
  const [expectedReviewHash, setExpectedReviewHash] = useState(ability.review_evidence_hash);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setShape(ability.review?.source_shape ?? "");
      setCues(JSON.stringify(ability.review?.cues ?? {}, null, 2));
      setExpectedReviewHash(ability.review_evidence_hash);
    }
  }, [ability, dirty]);
  useEffect(() => {
    onDirtyChange(dirty ? ability.id : null);
    return () => onDirtyChange(null);
  }, [ability.id, dirty, onDirtyChange]);
  function changeShape(value: string) {
    setShape(value);
    setDirty(value !== (ability.review?.source_shape ?? "") || cues !== JSON.stringify(ability.review?.cues ?? {}, null, 2));
  }
  function changeCues(value: string) {
    setCues(value);
    setDirty(shape !== (ability.review?.source_shape ?? "") || value !== JSON.stringify(ability.review?.cues ?? {}, null, 2));
  }
  return <section className="wb-census" aria-labelledby="wb-census-title">
    <h3 id="wb-census-title">Whole-context safety check</h3>
    <label className="wb-check"><input type="checkbox" checked={ability.review?.whole_context_checked ?? false}
      disabled={disabled || (!(ability.review?.whole_context_checked ?? false) && !ability.progress.readiness.ready)}
      onChange={(event) => save(event.target.checked, shape, cues, expectedReviewHash)} />
      <span>I checked the complete source, including qualifiers and unpainted regions.</span></label>
    <p className="wb-help">{ability.progress.readiness.ready
      ? "Separate from span approval. Checking opens exactly one composition gap. Source or span changes invalidate this check."
      : "Available once every meaningful byte is reviewed and nothing is pending; see Source accounting above."}</p>
    <details><summary>Source-shape census</summary>
      <label>Descriptive shape<input list="wb-shapes" value={shape} onChange={(event) => changeShape(event.target.value)} placeholder="C→E" /></label>
      <datalist id="wb-shapes">{["E", "C→E", "T→E", "C→AND(E,E)", "OTHER"].map((value) => <option key={value} value={value} />)}</datalist>
      <label>Cues JSON<textarea rows={3} value={cues} onChange={(event) => changeCues(event.target.value)} spellCheck={false} /></label>
      <button className="secondary" disabled={disabled} onClick={() => save(ability.review?.whole_context_checked ?? false, shape, cues, expectedReviewHash)}>Save census</button>
    </details>
  </section>;
}

function MetricValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="wb-muted">Unknown</span>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "number") return <>{value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</>;
  if (typeof value === "string") return <>{value}</>;
  if (Array.isArray(value)) return value.length ? <ol className="wb-metric-list">{value.map((item, index) => <li key={index}><MetricValue value={item} /></li>)}</ol> : <span className="wb-muted">No observations</span>;
  return <dl className="wb-metrics">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd><MetricValue value={item} /></dd></div>)}</dl>;
}

function stampGuards(guards: StampGuard[]): string {
  return guards.map((guard) => "literal" in guard
    ? `exact ${JSON.stringify(guard.literal)}`
    : guard.boundary === "fragment" ? "fragment edge" : "word boundary").join(" or ");
}

function stampMeaning(output: LeafStampVariant["output"]): string {
  const parameters = output.parameters;
  if (output.family_id === "reroll" && parameters !== null && typeof parameters === "object" && !Array.isArray(parameters) && "roll" in parameters && "subset" in parameters) {
    const roll = parameters.roll === "hit" ? "Hit" : parameters.roll === "wound" ? "Wound" : null;
    if (roll && parameters.subset === "all") return `Re-roll ${roll} rolls`;
    if (roll && parameters.subset === "ones") return `Re-roll ${roll} rolls of 1`;
  }
  return output.family_id.replaceAll("-", " ");
}

function stampParameters(parameters: StampTemplate): string {
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) return JSON.stringify(parameters);
  return Object.entries(parameters).map(([key, value]) =>
    `${key.replaceAll("_", " ")}: ${value !== null && typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ") || "none";
}

const CHALLENGE_LABELS: Record<StampChallengeState, { label: string; tone: "approved" | "blocked" | "proposed" }> = {
  "not-required": { label: "not required", tone: "approved" },
  clear: { label: "clear", tone: "approved" },
  missing: { label: "not run", tone: "proposed" },
  incomplete: { label: "incomplete", tone: "proposed" },
  "self-challenge": { label: "not independent", tone: "blocked" },
  "not-pinned": { label: "not pinned to this definition", tone: "blocked" },
  objection: { label: "objection", tone: "blocked" },
  unresolved: { label: "unresolved", tone: "blocked" },
};

/** Approval needs a clear challenge, or a human resolution typed for an objection. */
function approvalReady(eligibility: StampApprovalEligibility, objectionResolution: string): boolean {
  if (eligibility.approvable) return true;
  return eligibility.blocker?.next_action === "resolve-objection" && objectionResolution.trim().length > 0;
}

function StampRuleReview({ definition, positives, inspectSource }: {
  definition: StampDefinition;
  positives: StampEvidenceReference[];
  inspectSource: (id: number) => void;
}) {
  return <section className="wb-rule-summary" aria-label="Stamp rule and source evidence">
    <h3>Proposed interpretation</h3>
    {definition.variants.map((variant) => <article className="wb-rule-variant" key={variant.id}>
      <h4>Source pattern · {variant.id}</h4>
      {variant.fragments.map((fragment) => <div key={fragment.fragment}>
        <p className="wb-rule-label">Match in {fragment.fragment.replaceAll("_", " ").toLowerCase()}</p>
        <blockquote className="wb-rule-pattern">{fragment.segments.map((segment) =>
          <span key={segment.id} className={"literal" in segment ? "" : "wb-rule-binding"}>
            {"literal" in segment ? segment.literal : "slot" in segment ? `{${segment.slot}}` : `{${segment.leaf.family_id}@${segment.leaf.family_version}}`}
          </span>)}</blockquote>
      </div>)}
      {"output" in variant
        ? <dl className="wb-rule-facts">
          <div><dt>Interprets as</dt><dd><strong>{stampMeaning(variant.output)}</strong></dd></div>
          <div><dt>Mechanic</dt><dd>{variant.output.family_id}@{variant.output.family_version}</dd></div>
          <div><dt>Parameters</dt><dd>{stampParameters(variant.output.parameters)}</dd></div>
          <div><dt>Before match</dt><dd>{stampGuards(variant.before)}</dd></div>
          <div><dt>After match</dt><dd>{stampGuards(variant.after)}</dd></div>
        </dl>
        : <p className="wb-help">Complete-source graph; {variant.mechanics_template === null ? "DSL mapping unresolved" : "DSL mapping supplied"}.</p>}
      {variant.source_types !== "any" && <p className="wb-help">Source types: {variant.source_types.map((type) => type ?? "unspecified").join(", ")}</p>}
      {Object.entries(variant.slots).length > 0 && <dl className="wb-rule-facts">{Object.entries(variant.slots).map(([name, slot]) =>
        <div key={name}><dt>Slot {name}</dt><dd>{slot.kind === "integer" ? `integer ${slot.min} to ${slot.max}` : slot.values.map((value) => `${value.text} → ${JSON.stringify(value.value)}`).join("; ")}</dd></div>)}</dl>}
      <details><summary>Full variant JSON</summary><pre className="wb-artifact">{JSON.stringify(variant, null, 2)}</pre></details>
    </article>)}
    <div className="wb-rule-evidence">
      <h4>Supporting source evidence</h4>
      {positives.map((source, index) => <div key={index}>
        <blockquote>{source.synthetic ? source.source_text : source.exact_text}</blockquote>
        {source.synthetic ? <small>Synthetic example, not an observed occurrence</small>
          : <button className="text-button" onClick={() => inspectSource(source.ability_version_id)}>Inspect complete source · ability version {source.ability_version_id}</button>}
      </div>)}
    </div>
  </section>;
}

/** Known leaves, reviewed connectives, and what is still open: the gate for upward composition. */
function LeafProgressStrip({ progress }: { progress: LeafProgress }) {
  const open = progress.pending_proposals + progress.unresolved_proposals + progress.open_leaf_gaps;
  return <div className="wb-leaf-progress" aria-label="Leaf progress">
    {progress.leaves.length ? progress.leaves.map((leaf) => <span key={`${leaf.family_id}:${leaf.authority_kind}`} className="wb-leaf-chip">{leaf.family_id} ×{leaf.count}{leaf.authority_kind === "stamp" ? " (stamp)" : ""}</span>) : <span className="wb-help">No confirmed leaves</span>}
    {progress.connective_bytes > 0 && <span>{progress.connective_bytes} connective bytes reviewed</span>}
    {open > 0 && <span>{progress.pending_proposals} pending · {progress.unresolved_proposals} unresolved · {progress.open_leaf_gaps} leaf gaps</span>}
    {progress.residue_regions > 0 && <span>{progress.residue_regions} unclaimed region{progress.residue_regions === 1 ? "" : "s"} ({progress.residue_bytes} bytes)</span>}
    <span className={progress.composition_ready ? "wb-reviewed" : ""}>{progress.composition_ready ? "Ready for composition" : "Not composition-ready"}</span>
  </div>;
}

export default function WorkbenchApp() {
  const [view, setView] = useState<View>("queue");
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [familySignature, setFamilySignature] = useState<string | null>(null);
  const [lunaMode, setLunaMode] = useState<LunaMode>("coverage");
  const [page, setPage] = useState<AbilityPage>({ items: [], next_cursor: null });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [searchInput, setSearchInput] = useState("");
  const [reviewState, setReviewState] = useState<"pending" | "reviewed">("pending");
  const [reselecting, setReselecting] = useState(false);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [focused, setFocused] = useState<Ability | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [uncoveredSelection, setUncoveredSelection] = useState<UncoveredSelection[]>([]);
  const [dirtyCensusAbilityId, setDirtyCensusAbilityId] = useState<number | null>(null);
  const [censusResetToken, setCensusResetToken] = useState(0);
  const [factions, setFactions] = useState<string[]>([]);
  const [faction, setFaction] = useState("");
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [viewLoading, setViewLoading] = useState(false);
  const [registryLoading, setRegistryLoading] = useState(false);
  const loading = pageLoading || viewLoading || registryLoading;
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading a bounded page of complete abilities.");
  const [batches, setBatches] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [shortcuts, setShortcuts] = useState(false);
  const [family, setFamily] = useState("");
  const [families, setFamilies] = useState<ReviewedFamily[]>([]);
  const [familyPage, setFamilyPage] = useState<FamilyPage>({ groups: [], next_cursor: null, progress: { reviewed: 0, total: 0 } });
  const [familyCursors, setFamilyCursors] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [familyCorrection, setFamilyCorrection] = useState({ family: "", role: "EFFECT", version: "1", parameters: "{}" });
  const [frontier, setFrontier] = useState<Frontier | null>(null);
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [run, setRun] = useState<PreparedRun | null>(null);
  const [runId, setRunId] = useState("");
  const [lunaResponse, setLunaResponse] = useState("");
  const [lunaLimit, setLunaLimit] = useState(12);
  const [stampPage, setStampPage] = useState<StampPage>({ items: [], next_cursor: null, total: 0 });
  const [stampStatus, setStampStatus] = useState("");
  const [stampCursors, setStampCursors] = useState<(string | null)[]>([null]);
  const [selectedStamp, setSelectedStamp] = useState<StampIdentity | null>(null);
  const [stampDetail, setStampDetail] = useState<StampDetail | null>(null);
  const [stampDefinition, setStampDefinition] = useState("{}");
  const [stampPositives, setStampPositives] = useState("[]");
  const [stampCounterexamples, setStampCounterexamples] = useState("[]");
  const [stampFormBaseline, setStampFormBaseline] = useState({ definition: "{}", positives: "[]", counterexamples: "[]" });
  const [stampPreview, setStampPreview] = useState<StampPreview | null>(null);
  const [stampPreviewCursors, setStampPreviewCursors] = useState<(string | null)[]>([null]);
  const [stampPreviewStale, setStampPreviewStale] = useState(false);
  const [stampPreviewNonce, setStampPreviewNonce] = useState(0);
  const [stampAudit, setStampAudit] = useState<StampAuditPage | null>(null);
  const [stampAuditCursors, setStampAuditCursors] = useState<(string | null)[]>([null]);
  const [stampReason, setStampReason] = useState("");
  const [objectionResolution, setObjectionResolution] = useState("");
  const [draftPage, setDraftPage] = useState<DraftPage>({ items: [], next_cursor: null, total: 0 });
  const [draftStatus, setDraftStatus] = useState("");
  const [draftCursors, setDraftCursors] = useState<(string | null)[]>([null]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [draftDetail, setDraftDetail] = useState<DraftDetail | null>(null);
  const [escalationPage, setEscalationPage] = useState<EscalationPage>({ items: [], next_cursor: null, total: 0 });
  const [escalationStatus, setEscalationStatus] = useState<"open" | "deferred">("open");
  const [escalationCursors, setEscalationCursors] = useState<(string | null)[]>([null]);
  const [escalationNotes, setEscalationNotes] = useState<Record<string, string>>({});
  const [workPurpose, setWorkPurpose] = useState<WorkPurpose>("propose-rule");
  const [workIds, setWorkIds] = useState("");
  const [workLimit, setWorkLimit] = useState(3);
  const [workRetryReason, setWorkRetryReason] = useState("");
  const [preparedWork, setPreparedWork] = useState<PreparedWork | null>(null);
  const [workRunId, setWorkRunId] = useState("");
  const [workResponse, setWorkResponse] = useState("");
  const [workReport, setWorkReport] = useState<WorkImportReport | null>(null);
  /** Background DeepSeek runs this page started, by run id, until each finishes. */
  const [workJobs, setWorkJobs] = useState<Record<string, WorkJob>>({});
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const knownWorkbenchRevision = useRef<number | null>(null);
  const revisionRequestInFlight = useRef(false);
  const localRevisionExpected = useRef(false);
  const activeRevisionMutation = useRef(false);
  const dirtyState = useRef(false);
  const dirtyAbilityId = useRef<number | null>(null);
  const selectedStampState = useRef<StampIdentity | null>(null);
  const stampPreviewState = useRef<StampPreview | null>(null);
  const stampEditorDirtyState = useRef(false);
  const selectedDraftState = useRef<string | null>(null);
  const stampPreviewCursorState = useRef<string | null>(null);
  const inspector = useRef<HTMLElement>(null);
  const visible = focused ? [focused] : page.items;
  const ability = focused ?? page.items.find((item) => item.id === activeId) ?? null;
  const cursor = cursors[cursors.length - 1];
  const familyCursor = familyCursors[familyCursors.length - 1];
  const stampCursor = stampCursors[stampCursors.length - 1];
  const stampPreviewCursor = stampPreviewCursors[stampPreviewCursors.length - 1];
  const stampAuditCursor = stampAuditCursors[stampAuditCursors.length - 1];
  const draftCursor = draftCursors[draftCursors.length - 1];
  const escalationCursor = escalationCursors[escalationCursors.length - 1];
  const safeProposals = ability?.proposals.filter((proposal) => proposal.status === "pending" && proposal.family_id && ROLES.includes(proposal.role as Role)
    && !ability.annotations.some((span) => overlaps(span, proposal))
    && !ability.proposals.some((other) => pending(other) && other.id !== proposal.id && overlaps(proposal, other))) ?? [];
  const canWrite = !busy && !loading;
  useEffect(() => { if (!draft || view !== "abilities") setReselecting(false); }, [draft, view]);

  useEffect(() => {
    const controller = new AbortController();
    api<string[]>("/factions", undefined, controller.signal)
      .then((result) => {
        setFactions(result);
        setFaction((current) => current && !result.includes(current) ? "" : current);
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    api<ReviewedFamily[]>("/semantic-families", undefined, controller.signal)
      .then(setFamilies)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPageLoading(true); setError(null);
    api<AbilityPage>(`/abilities?limit=12&reviewState=${reviewState}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${search ? `&query=${encodeURIComponent(search)}` : ""}${faction ? `&faction=${encodeURIComponent(faction)}` : ""}`, undefined, controller.signal)
      .then((result) => {
        setPage((current) => ({
          ...result,
          items: result.items.map((item) => item.id === dirtyAbilityId.current
            ? current.items.find((existing) => existing.id === item.id) ?? item
            : item),
        }));
        setActiveId((id) => result.items.some((item) => item.id === id) ? id : result.items[0]?.id ?? null);
        if (view === "abilities" && revision === 0) setStatus(`${result.items.length} ${reviewState === "pending" ? "awaiting review" : "reviewed"} ${result.items.length === 1 ? "ability" : "abilities"} loaded. Select a span or unpainted text to inspect it.`);
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setPageLoading(false); });
    return () => controller.abort();
  }, [cursor, search, faction, reviewState, revision]);

  useEffect(() => {
    if (view === "abilities" || view === "luna" || view === "ontology" || view === "compose" || view === "stamps" || view === "drafts" || view === "work" || (view === "family" && !family)) {
      setViewLoading(false);
      return;
    }
    const controller = new AbortController();
    setViewLoading(true); setError(null);
    if (view === "frontier") setFrontier(null);
    if (view === "dashboard") setDashboard(null);
    const path = view === "family"
      ? `/families/${encodeURIComponent(family)}/candidates?${familySignature ? "" : "limit=20"}${familyCursor ? `&cursor=${encodeURIComponent(familyCursor)}` : ""}${familySignature ? `&signature=${encodeURIComponent(familySignature)}` : ""}${faction ? `&faction=${encodeURIComponent(faction)}` : ""}`
      : view === "queue" ? `/queue${faction ? `?faction=${encodeURIComponent(faction)}` : ""}` : `/${view}`;
    api<unknown>(path, undefined, controller.signal).then((result) => {
      if (view === "queue") setQueue(result as WorkQueue);
      if (view === "family") setFamilyPage(result as FamilyPage);
      if (view === "frontier") setFrontier(result as Frontier);
      if (view === "dashboard") setDashboard(result as Record<string, unknown>);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setViewLoading(false); });
    return () => controller.abort();
  }, [view, family, familyCursor, familySignature, faction, revision]);

  useEffect(() => {
    if (view !== "family") return;
    setSelected(new Set());
    setSelectedGroup(null);
  }, [view, family, familyCursor, faction]);

  useEffect(() => {
    if (view !== "stamps") return;
    const controller = new AbortController();
    setRegistryLoading(true); setError(null);
    api<StampPage>(`/stamps${stampStatus ? `?status=${encodeURIComponent(stampStatus)}${stampCursor ? `&cursor=${encodeURIComponent(stampCursor)}` : ""}` : stampCursor ? `?cursor=${encodeURIComponent(stampCursor)}` : ""}`, undefined, controller.signal)
      .then((result) => {
        setStampPage(result);
        setSelectedStamp((current) => current ?? (result.items[0] ? { id: result.items[0].id, revision: result.items[0].revision } : null));
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) fail(cause); })
      .finally(() => { if (!controller.signal.aborted) setRegistryLoading(false); });
    return () => controller.abort();
  }, [view, stampStatus, stampCursor, revision]);

  useEffect(() => {
    if (!selectedStamp) {
      setStampDetail(null);
      setStampPreview(null);
      return;
    }
    const controller = new AbortController();
    api<StampDetail>(`/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}`, undefined, controller.signal)
      .then((result) => installStampDetail(result))
      .catch((cause: unknown) => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
  }, [selectedStamp?.id, selectedStamp?.revision]);

  // Approval and suspension submit the corpus-wide preview hash, so the preview is loaded with the
  // revision rather than left as an undiscoverable prerequisite for the decision controls.
  useEffect(() => {
    if (!selectedStamp) return;
    const controller = new AbortController();
    setStampPreview(null);
    setStampPreviewStale(false);
    api<StampPreview>(`/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}/preview`, {}, controller.signal)
      .then((result) => { setStampPreview(result); setStampPreviewStale(false); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
  }, [selectedStamp?.id, selectedStamp?.revision, stampPreviewNonce]);

  useEffect(() => {
    if (view !== "drafts") return;
    const controller = new AbortController();
    setRegistryLoading(true); setError(null);
    api<DraftPage>(`/drafts${draftStatus ? `?status=${encodeURIComponent(draftStatus)}${draftCursor ? `&cursor=${encodeURIComponent(draftCursor)}` : ""}` : draftCursor ? `?cursor=${encodeURIComponent(draftCursor)}` : ""}`, undefined, controller.signal)
      .then((result) => {
        setDraftPage(result);
        setSelectedDraftId((current) => current ?? result.items[0]?.id ?? null);
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) fail(cause); })
      .finally(() => { if (!controller.signal.aborted) setRegistryLoading(false); });
    return () => controller.abort();
  }, [view, draftStatus, draftCursor, revision]);

  useEffect(() => {
    if (!selectedDraftId) {
      setDraftDetail(null);
      return;
    }
    const controller = new AbortController();
    api<DraftDetail>(`/drafts/${encodeURIComponent(selectedDraftId)}`, undefined, controller.signal)
      .then(setDraftDetail)
      .catch((cause: unknown) => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
  }, [selectedDraftId]);

  useEffect(() => {
    if (view !== "frontier") return;
    const controller = new AbortController();
    setRegistryLoading(true); setError(null);
    api<EscalationPage>(`/escalations?status=${escalationStatus}${escalationCursor ? `&cursor=${encodeURIComponent(escalationCursor)}` : ""}`, undefined, controller.signal)
      .then(setEscalationPage)
      .catch((cause: unknown) => { if (!controller.signal.aborted) fail(cause); })
      .finally(() => { if (!controller.signal.aborted) setRegistryLoading(false); });
    return () => controller.abort();
  }, [view, escalationStatus, escalationCursor, revision]);

  // Poll background work runs without holding the page's write lock.
  useEffect(() => {
    const running = Object.values(workJobs).filter((job) => job.state === "running").map((job) => job.run_id);
    if (!running.length) return;
    const timer = window.setInterval(() => {
      for (const runId of running) {
        api<{ run_id: string; status: string; job: WorkJob | null }>(`/work/runs/${runId}`).then((view) => {
          const job = view.job;
          if (!job || job.state === "running") return;
          setWorkJobs((current) => ({ ...current, [runId]: job }));
          if (job.state === "completed" && job.report) {
            setWorkReport(job.report);
            setStatus(`Run ${runId} finished: ${job.report.imported} imported, ${job.report.stale} stale, ${job.report.failed} failed. Imported rules still require human approval.`);
          } else {
            setStatus(`Run ${runId} did not finish: ${job.error ?? "unknown failure"} The prepared run stays pending; run it again from Model work.`);
          }
          setRevision((value) => value + 1);
        }).catch(() => undefined);
      }
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [workJobs]);

  function fail(cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)); }
  async function perform(work: () => Promise<void>, expectsRevision = true) {
    if (mutation.current) return;
    mutation.current = true;
    activeRevisionMutation.current = expectsRevision;
    setBusy(true); setError(null);
    try {
      await work();
      await syncWorkbenchRevision(expectsRevision);
    } catch (cause) {
      fail(cause);
    } finally {
      activeRevisionMutation.current = false;
      mutation.current = false;
      setBusy(false);
    }
  }

  function installStampDetail(result: StampDetail) {
    const definition = JSON.stringify(result.definition, null, 2);
    const positives = JSON.stringify(result.positives, null, 2);
    const counterexamples = JSON.stringify(result.counterexamples, null, 2);
    setStampDetail(result);
    setStampDefinition(definition);
    setStampPositives(positives);
    setStampCounterexamples(counterexamples);
    setStampFormBaseline({ definition, positives, counterexamples });
  }

  async function syncWorkbenchRevision(localChange = false) {
    if (revisionRequestInFlight.current) {
      if (localChange) localRevisionExpected.current = true;
      return;
    }
    revisionRequestInFlight.current = true;
    try {
      const result = await api<{ revision: number }>("/revision");
      const previous = knownWorkbenchRevision.current;
      knownWorkbenchRevision.current = result.revision;
      if (previous === null || previous === result.revision) {
        if (localChange) localRevisionExpected.current = false;
        return;
      }
      const isLocalChange = localChange || activeRevisionMutation.current || localRevisionExpected.current;
      localRevisionExpected.current = false;
      setRevision((value) => value + 1);
      if (isLocalChange) return;

      const warning = dirtyState.current
        ? "Workbench changed; review updated evidence"
        : "Workbench changed in another session. Current lists were refreshed.";
      setExternalNotice(warning);
      setStatus(warning);

      const stamp = selectedStampState.current;
      const preview = stampPreviewState.current;
      if (stamp && preview) {
        try {
          const refreshed = await api<StampPreview>(
            `/stamps/${encodeURIComponent(stamp.id)}/${stamp.revision}/preview`,
            stampPreviewCursorState.current ? { cursor: stampPreviewCursorState.current } : {},
          );
          if (refreshed.preview_hash === preview.preview_hash) {
            setStampPreview(refreshed);
            setStampPreviewStale(false);
          } else {
            setStampPreviewStale(true);
            setExternalNotice("Workbench changed; review updated evidence");
            setStatus("Workbench changed; review updated evidence");
          }
        } catch {
          setStampPreviewStale(true);
          setExternalNotice("Workbench changed; review updated evidence");
          setStatus("Workbench changed; review updated evidence");
        }
      }
      if (stamp && !stampEditorDirtyState.current) {
        api<StampDetail>(`/stamps/${encodeURIComponent(stamp.id)}/${stamp.revision}`)
          .then(installStampDetail)
          .catch(() => undefined);
      }
      const currentDraft = selectedDraftState.current;
      if (currentDraft) {
        api<DraftDetail>(`/drafts/${encodeURIComponent(currentDraft)}`)
          .then(setDraftDetail)
          .catch(() => undefined);
      }
    } finally {
      revisionRequestInFlight.current = false;
    }
  }

  function chooseStamp(stamp: StampIdentity) {
    if (selectedStamp?.id === stamp.id && selectedStamp.revision === stamp.revision) return;
    setSelectedStamp(stamp);
    setStampDetail(null);
    setStampPreview(null);
    setStampPreviewCursors([null]);
    setStampPreviewStale(false);
    setStampAudit(null);
    setStampAuditCursors([null]);
    setStampReason("");
    setObjectionResolution("");
  }

  async function refreshSelectedStamp() {
    if (!selectedStamp) return;
    const refreshed = await api<StampDetail>(`/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}`);
    installStampDetail(refreshed);
  }

  async function loadStampPreview(cursorOverride = stampPreviewCursor) {
    if (!selectedStamp) return;
    const preview = await api<StampPreview>(
      `/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}/preview`,
      cursorOverride ? { cursor: cursorOverride } : {},
    );
    setStampPreview(preview);
    setStampPreviewStale(false);
    setStatus(`Previewed ${preview.totals.eligible} eligible, ${preview.totals.already_satisfied} already satisfied, and ${preview.totals.blocked} blocked corpus occurrences.`);
  }

  async function loadStampAudit(cursorOverride = stampAuditCursor) {
    if (!selectedStamp) return;
    const page = await api<StampAuditPage>(
      `/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}/audit${cursorOverride ? `?cursor=${encodeURIComponent(cursorOverride)}` : ""}`,
    );
    setStampAudit(page);
    setStatus(`Loaded an optional reproducible audit sample of ${page.coverage.selected} from ${page.coverage.applications} active applications.`);
  }

  function recordAudit(item: StampAuditItem, verdict: "correct" | "incorrect" | "uncertain", scope?: "occurrence" | "rule") {
    if (!selectedStamp) return;
    void perform(async () => {
      const result = await api<StampAuditResult>(
        `/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}/audit`,
        {
          application_id: item.application_id,
          reviewer: REVIEWER,
          source_hash: item.source_hash,
          dependency_hash: item.dependency_hash,
          verdict,
          ...(scope ? { scope } : {}),
        },
      );
      if (result.correction) {
        const source = await api<Ability>(`/abilities/${result.correction.ability_version_id}`);
        const fragment = source.fragments.find((candidate) => candidate.fragment === result.correction!.fragment);
        if (!fragment || sourceSlice(source, fragment.fragment, result.correction.start_byte, result.correction.end_byte) !== result.correction.exact_text) {
          throw new Error("The audited occurrence changed before its correction editor opened.");
        }
        setFocused(source);
        setActiveId(source.id);
        setDraft({
          ability_id: source.id,
          source_hash: source.source_hash,
          fragment: fragment.fragment,
          start: String(result.correction.start_byte),
          end: String(result.correction.end_byte),
          role: "EFFECT",
          family: "",
          version: "1",
          parameters: "{}",
          overlap: false,
          kind: "selection",
        });
        setView("abilities");
        setStampAudit(null);
        setStatus("The audited interpretation is excluded for this occurrence. Review the complete source and record the correct source-bound meaning.");
        return;
      }
      setStampAuditCursors([null]);
      await loadStampAudit(null);
      if (scope === "rule") await refreshSelectedStamp();
      const published = result.affected_published_entries.length;
      setStatus(verdict === "correct"
        ? "Audit recorded as correct. Propagation remains optional and unchanged."
        : verdict === "uncertain"
          ? "Audit recorded as uncertain. A source-bound challenge was queued without suspending the rule."
          : `Rule authority suspended and dependent results invalidated.${published ? ` ${published} published ${published === 1 ? "entry was" : "entries were"} identified for explicit follow-up; published data was not rewritten.` : ""}`);
    });
  }

  function createLiteralStamp(annotation: Annotation) {
    void perform(async () => {
      const result = await api<{ stamp_id: string; revision: number }>("/stamps/propose", {
        annotation_id: annotation.id,
        reviewer: REVIEWER,
      });
      setDraft(null);
      setView("stamps");
      chooseStamp(stampIdentity(result));
      setStatus("Literal stamp proposed from the current human-confirmed occurrence. Preview the full corpus before approval.");
    });
  }

  function proposeStampRevision() {
    if (!stampDetail) return;
    void perform(async () => {
      const definition: unknown = JSON.parse(stampDefinition);
      const positives: unknown = JSON.parse(stampPositives);
      const counterexamples: unknown = JSON.parse(stampCounterexamples);
      if (!Array.isArray(positives) || !Array.isArray(counterexamples)) {
        throw new Error("Positive and counterexample evidence must be JSON arrays.");
      }
      const result = stampIdentity(await api<{ stamp_id: string; revision: number }>("/stamps/propose", {
        stamp_id: stampDetail.id,
        base_revision: stampDetail.revision,
        definition,
        positives,
        counterexamples,
      }));
      chooseStamp(result);
      setStatus(`Proposed ${result.id}@${result.revision}. Approval still requires a fresh corpus preview.`);
    });
  }

  /** Confirm one selected family occurrence and propose a literal stamp seeded by it. */
  function confirmOneAndProposeStamp(group: FamilyGroup) {
    const occurrence = selectedGroup === group.signature ? group.occurrences.find((item) => selected.has(item.proposal_id)) : group.occurrences[0];
    if (!occurrence) return;
    void perform(async () => {
      const source = await api<Ability>(`/abilities/${occurrence.ability_version_id}`);
      const proposal = source.proposals.find((entry) => entry.id === occurrence.proposal_id && pending(entry));
      if (!proposal || source.source_hash !== occurrence.source_hash) throw new Error("This occurrence changed. Reload Family mode before confirming it.");
      const result = await api<{ batch_id: string; stamp_id: string; revision: number }>("/stamps/confirm-and-propose", {
        reviewer: REVIEWER, decision: proposalDecision(source, proposal, "confirm"),
      });
      setBatches((current) => [...current, result.batch_id]);
      setView("stamps");
      chooseStamp(stampIdentity(result));
      setStatus("Confirmed one occurrence and proposed a literal stamp from it. The corpus preview decides every other match.");
    });
  }
  function proposeSeededStamp(annotationId: number) {
    void perform(async () => {
      const result = await api<{ stamp_id: string; revision: number }>("/stamps/propose", { annotation_id: annotationId, reviewer: REVIEWER });
      setView("stamps");
      chooseStamp(stampIdentity(result));
      setStatus("Literal stamp proposed from the existing human seed. Preview the full corpus before approval.");
    });
  }
  function escalateSelectedStamp() {
    if (!selectedStamp) return;
    void perform(async () => {
      const result = await api<{ escalation_id: string }>(`/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}/escalate`, {});
      setView("work"); setWorkPurpose("propose-rule"); setWorkIds(result.escalation_id);
      await prepareAndRunWork("propose-rule", [result.escalation_id]);
    });
  }
  function refreshSourceStore() {
    void perform(async () => {
      const result = await api<{ inserted: number; retained: number; reactivated: number; retired: number }>("/sources/refresh", {});
      setStatus(`Source refresh: ${result.inserted} new, ${result.reactivated} reactivated, ${result.retired} retired, ${result.retained} unchanged source versions.`);
    });
  }

  function prepareChallengeWork(stamp: StampIdentity) {
    const key = `${stamp.id}@${stamp.revision}`;
    setView("work");
    setWorkPurpose("challenge-rule");
    setWorkIds(key);
    void perform(() => prepareAndRunWork("challenge-rule", [key]));
  }

  function approveSelectedStamp() {
    if (!selectedStamp || !stampPreview || stampPreviewStale) return;
    void perform(async () => {
      const result = await api<{ approval_batch_id: string; applied: number; already_satisfied: number; blocked: number }>(
        `/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}/approve`,
        {
          reviewer: REVIEWER,
          preview_hash: stampPreview.preview_hash,
          ...(objectionResolution.trim() ? { objection_resolution: objectionResolution.trim() } : {}),
        },
      );
      setBatches((current) => [...current, result.approval_batch_id]);
      setStampPreviewCursors([null]);
      setStampPreviewNonce((value) => value + 1);
      await refreshSelectedStamp();
      setStatus(`Approved and applied to ${result.applied} matches. ${result.already_satisfied} were already satisfied; ${result.blocked} remain blocked.`);
    });
  }

  function rejectSelectedStamp() {
    if (!selectedStamp || !stampDetail || !stampReason.trim()) return;
    void perform(async () => {
      const result = await api<{ batch_id: string }>(
        `/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}/reject`,
        { reviewer: REVIEWER, definition_hash: stampDetail.definition_hash, reason: stampReason.trim() },
      );
      setBatches((current) => [...current, result.batch_id]);
      setStampPreviewCursors([null]);
      setStampPreviewNonce((value) => value + 1);
      await refreshSelectedStamp();
      setStatus("Rule proposal rejected. Its source occurrences remain unresolved.");
    });
  }

  function suspendSelectedStamp() {
    if (!selectedStamp || !stampPreview || stampPreviewStale || !stampReason.trim()) return;
    void perform(async () => {
      const result = await api<{ batch_id: string; affected_published_entries: StampAuditResult["affected_published_entries"] }>(
        `/stamps/${encodeURIComponent(selectedStamp.id)}/${selectedStamp.revision}/suspend`,
        { reviewer: REVIEWER, preview_hash: stampPreview.preview_hash, reason: stampReason.trim() },
      );
      setBatches((current) => [...current, result.batch_id]);
      setStampPreviewCursors([null]);
      setStampPreviewNonce((value) => value + 1);
      await refreshSelectedStamp();
      const published = result.affected_published_entries.length;
      setStatus(`Rule authority suspended. Dependent applications and drafts were invalidated.${published ? ` ${published} published ${published === 1 ? "entry was" : "entries were"} identified for explicit follow-up; published data was not rewritten.` : ""}`);
    });
  }

  function decideEscalationItem(item: Escalation, action: "defer" | "reopen" | "request-revision") {
    const note = escalationNotes[item.id]?.trim();
    if (action === "request-revision" && !note) return;
    void perform(async () => {
      await api(`/escalations/${encodeURIComponent(item.id)}/decision`, {
        reviewer: REVIEWER,
        evidence_hash: item.evidence_hash,
        action,
        ...(note ? { note } : {}),
      });
      setEscalationNotes((current) => ({ ...current, [item.id]: "" }));
      setStatus(action === "defer" ? "Escalation deferred without resolving its coverage." : action === "reopen" ? "Escalation reopened." : "Revision requested. The note will be included in the next proposal packet.");
    });
  }

  async function prepareModelWork(purpose: WorkPurpose, ids?: string[]): Promise<PreparedWork> {
    const result = await api<PreparedWork>("/work/prepare", {
      purpose,
      limit: workLimit,
      ...(ids?.length ? { ids } : {}),
      ...(workRetryReason.trim() ? { retry_reason: workRetryReason.trim() } : {}),
    });
    setPreparedWork(result);
    setWorkPurpose(purpose);
    setWorkIds(ids?.join(", ") ?? workIds);
    setWorkRunId(result.run_id);
    setWorkReport(null);
    setStatus(`${purpose} packet ${result.reused ? "reused" : "prepared"} at ${result.request_path}. Run it with DeepSeek or export it for manual execution.`);
    return result;
  }
  async function runPreparedWork(prepared: PreparedWork) {
    if (prepared.status !== "pending") {
      setStatus(`Work run ${prepared.run_id} is already completed. Supply a retry reason to prepare another run.`);
      return;
    }
    const job = await api<WorkJob>("/work/run", { run_id: prepared.run_id });
    trackWorkRuns([job.run_id]);
    setStatus(`DeepSeek is working on run ${job.run_id} in the background. Keep reviewing; the result appears here when it finishes.`);
  }
  function trackWorkRuns(runIds: string[]) {
    setWorkJobs((current) => ({
      ...current,
      ...Object.fromEntries(runIds.map((runId) => [runId, { run_id: runId, state: "running", started_at: new Date().toISOString(), finished_at: null, report: null, error: null } satisfies WorkJob])),
    }));
  }
  async function prepareAndRunWork(purpose: WorkPurpose, ids?: string[]) {
    await runPreparedWork(await prepareModelWork(purpose, ids));
  }
  async function refreshAbilities(ids: number[]) {
    const updates = await Promise.all([...new Set(ids)].map((id) => api<Ability>(`/abilities/${id}`)));
    const byId = new Map(updates.map((item) => [item.id, item]));
    setPage((current) => ({ ...current, items: current.items.map((item) => byId.get(item.id) ?? item) }));
    setFocused((current) => current ? byId.get(current.id) ?? current : null);
    return byId;
  }
  async function apply(decisions: Decision[]) {
    if (!decisions.length) throw new Error("Select at least one source-bound occurrence.");
    const result = await api<{ batch_id: string; applied: number }>("/annotations/batch", { reviewer: REVIEWER, decisions });
    setBatches((current) => [...current, result.batch_id]); setDraft(null);
    setStatus(`Recorded ${result.applied} decision${result.applied === 1 ? "" : "s"}. Whole-context checks are independent. Undo is available.`);
    const updated = await refreshAbilities(decisions.map((decision) => decision.ability_version_id));
    setUncoveredSelection((current) => {
      const remaining = current.flatMap((entry) => {
        const affected = decisions.filter((decision) => decision.ability_version_id === entry.ability_version_id
          && decision.source_hash === entry.source_hash && decision.fragment === entry.fragment && overlaps(entry, decision));
        if (!affected.length) return [entry];
        if (affected.some((decision) => decision.start_byte === entry.start_byte && decision.end_byte === entry.end_byte)) return [];
        if (!affected.some((decision) => decision.action === "confirm" || decision.action === "correct")) return [entry];
        const item = updated.get(entry.ability_version_id);
        return item?.coverage.uncovered.filter((region) => region.fragment === entry.fragment && overlaps(region, entry))
          .map((region) => ({ ...region, ability_version_id: item.id, source_hash: item.source_hash,
            ability_id: item.ability_id, faction_id: item.faction_id })) ?? [];
      });
      return [...new Map(remaining.map((entry) => [uncoveredKey(entry), entry])).values()];
    });
    if (view !== "abilities") setRevision((value) => value + 1);
  }
  function stageUncovered(items: Ability[], singleRegion?: Fragment) {
    const additions = items.flatMap((item) => (singleRegion ? [singleRegion] : item.coverage.uncovered).map((region): UncoveredSelection => ({
      ...region, ability_version_id: item.id, source_hash: item.source_hash, ability_id: item.ability_id, faction_id: item.faction_id,
    })));
    setUncoveredSelection((current) => {
      const seen = new Set(current.map(uncoveredKey));
      return [...current, ...additions.filter((entry) => {
        const key = uncoveredKey(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })];
    });
    setStatus(`Staged ${additions.length} source-bound uncovered regions for individual review. No decisions recorded.`);
  }
  function inspectUncovered(entry: UncoveredSelection) {
    void perform(async () => {
      const item = await api<Ability>(`/abilities/${entry.ability_version_id}`);
      const region = item.coverage.uncovered.find((candidate) => candidate.fragment === entry.fragment
        && candidate.start_byte === entry.start_byte && candidate.end_byte === entry.end_byte && candidate.text === entry.text);
      if (!item.current || item.source_hash !== entry.source_hash || !region) {
        setUncoveredSelection((current) => current.filter((candidate) => uncoveredKey(candidate) !== uncoveredKey(entry)));
        throw new Error("This staged region changed or was reviewed. Removed it from the selection set.");
      }
      setFocused(item); setView("abilities"); setReselecting(false); setActiveId(item.id);
      setDraft({ ability_id: item.id, source_hash: item.source_hash, fragment: region.fragment,
        start: String(region.start_byte), end: String(region.end_byte), role: "EFFECT",
        family: "", version: "1", parameters: "{}", overlap: false, kind: "selection" });
      setStatus("Inspecting a staged source region. Choose its role and family or record a leaf gap.");
      requestAnimationFrame(() => document.getElementById(`wb-ability-${item.id}`)?.scrollIntoView({ block: "start" }));
    }, false);
  }
  function inspect(item: Ability, span: Span, kind: Draft["kind"]) {
    setReselecting(false);
    setActiveId(item.id); setDraft(spanDraft(item, span, kind)); setError(null);
    inspector.current?.scrollIntoView({ block: "nearest" });
  }
  function select(item: Ability, fragment: Fragment, start: number, end: number, text: string) {
    if (!text.trim()) return;
    if (reselecting) {
      if (!draft || draft.ability_id !== item.id || draft.fragment !== fragment.fragment) {
        setError("Select replacement text in the same ability and source fragment, or cancel and start a new span.");
        return;
      }
      setDraft({ ...draft, start: String(start), end: String(end) });
      setReselecting(false); setError(null);
      setStatus("Updated selected text. Review its highlighted boundaries before applying the correction.");
    } else {
      setActiveId(item.id); setDraft({ ability_id: item.id, source_hash: item.source_hash, fragment: fragment.fragment,
        start: String(start), end: String(end), role: "EFFECT", family: "", version: "1", parameters: "{}", overlap: false, kind: "selection" });
      setStatus("Selected source text. Review the exact wording and family in the inspector.");
    }
    if (window.matchMedia("(max-width: 700px)").matches) requestAnimationFrame(() => inspector.current?.scrollIntoView({ block: "start" }));
  }
  function editDraft(patch: Partial<Draft>) { setDraft((current) => current ? { ...current, ...patch } : current); }
  function editParameter(field: string, value: unknown) {
    setDraft((current) => {
      if (!current) return current;
      const values = parameters(current.parameters);
      return { ...current, parameters: JSON.stringify({ ...values, [field]: value }, null, 2) };
    });
  }
  function decide(action: Action) {
    if (!ability || !draft || reselecting) return;
    void perform(async () => {
      const start = Number(draft.start); const end = Number(draft.end);
      const text = sourceSlice(ability, draft.fragment, start, end);
      const semantic = action === "confirm" || action === "correct";
      const connective = action === "confirm-connective";
      if (connective && (
        draft.kind !== "proposal" ||
        !draft.span ||
        draft.span.role !== "CONNECTIVE" ||
        (draft.span as Proposal).status !== "pending" ||
        draftChanged
      )) {
        throw new Error("Confirm the original pending connective proposal without changing its source boundaries.");
      }
      if (!semantic && !connective && draft.kind === "annotation") throw new Error("Confirmed annotations can be corrected, not rejected or relabelled as a new gap. Undo the original batch to retract a recent confirmation.");
      if (!semantic && !connective && draft.kind === "proposal" && draftChanged) throw new Error("Apply edited proposals as a correction, or reopen the original proposal before rejecting or flagging it.");
      if (semantic && (!draft.family.trim() || !ROLES.includes(draft.role as Role))) throw new Error("Choose a reviewed family and a semantic role before confirming. Connective and unresolved regions are not fingerprints.");
      const version = Number(draft.version);
      if (semantic && (!Number.isSafeInteger(version) || version < 1)) throw new Error("Family version must be a positive integer.");
      const decision: Decision = {
        action, ability_version_id: ability.id, source_hash: draft.source_hash,
        ...(draft.kind === "proposal" && draft.span ? { proposal_id: draft.span.id } : {}),
        ...(draft.kind === "annotation" && action === "correct" && draft.span
          ? { supersedes_annotation_id: draft.span.id }
          : {}),
        fragment: draft.fragment, start_byte: start, end_byte: end, exact_text: text, role: draft.role,
        ...(semantic ? { family_id: draft.family.trim(), family_version: version, parameters: parameters(draft.parameters), allow_overlap: draft.overlap } : {}),
      };
      await apply([decision]);
    });
  }
  function undo() {
    const batch = batches[batches.length - 1];
    if (!batch) return;
    void perform(async () => {
      await api(`/batches/${encodeURIComponent(batch)}/undo`, { reviewer: REVIEWER });
      setBatches((current) => current.slice(0, -1)); setDraft(null); setRevision((value) => value + 1);
      if (focused) await refreshAbilities([focused.id]);
      setStatus("Reversal recorded. Previous annotations restored without deleting history.");
    });
  }
  function navigateAbility(direction: number) {
    if (!visible.length) return;
    const index = Math.max(0, visible.findIndex((item) => item.id === activeId));
    const item = visible[Math.max(0, Math.min(visible.length - 1, index + direction))];
    setActiveId(item.id); setDraft(null);
    document.getElementById(`wb-ability-${item.id}`)?.scrollIntoView({ block: "start" });
  }
  function openFamily(id = draft?.family ?? "", signature: string | null = null) {
    setFamily(id); setFamilySignature(signature); setFamilyCursors([null]); setView("family");
    if (draft) setFamilyCorrection({ family: draft.family, role: draft.role, version: draft.version, parameters: draft.parameters });
  }
  function openAbility(id: number, proposalId?: number) {
    void perform(async () => {
      const item = await api<Ability>(`/abilities/${id}`);
      setFocused(item); setActiveId(item.id); setView("abilities");
      const proposal = item.proposals.find((entry) => entry.id === proposalId);
      setDraft(proposal ? spanDraft(item, proposal, "proposal") : null);
      setStatus("Inspecting the complete source. Return to the page or Family mode when finished.");
    }, false);
  }
  function openQueueItem(item: QueueItem) {
    const target = item.target;
    setError(null);
    if (target.view === "family") openFamily(target.family_id, target.signature);
    else if (target.view === "stamps") { setView("stamps"); chooseStamp({ id: target.stamp_id, revision: target.revision }); }
    else if (target.view === "abilities" && target.action === "whole-context") {
      setView("compose");
      setStatus("Every byte of these sources is reviewed. Select the ones you have read and record their checks together.");
    }
    else if (target.view === "abilities") {
      openAbility(target.ability_version_id);
      if (target.action) setStatus(target.action === "analyze-source"
        ? "This source has no proposals yet. Use Analyze source in the inspector, or select text to label it by hand."
        : "Every byte of this source is reviewed. Read it, then use \"I checked the whole source\" under Source accounting to open composition.");
    }
    else if (target.view === "work") { setView("work"); void perform(() => prepareAndRunWork("propose-rule", [target.escalation_id])); }
    else { setLunaMode(target.mode); setView("luna"); }
  }
  function chooseGroup(group: FamilyGroup) {
    if (selectedGroup === group.signature) return;
    const first = group.occurrences[0];
    if (first) setFamilyCorrection({ family: first.family_id, role: first.role, version: String(first.family_version), parameters: JSON.stringify(first.parameters, null, 2) });
    setSelectedGroup(group.signature);
  }
  function toggleOccurrence(group: FamilyGroup, id: number, checked: boolean) {
    chooseGroup(group);
    setSelected((current) => {
      const next = new Set(selectedGroup === group.signature ? current : []);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function selectMatchingContext(group: FamilyGroup) {
    const byContext = new Map<string, Occurrence[]>();
    for (const occurrence of group.occurrences) {
      const key = `${occurrence.context_signature}\u0000${occurrence.context}`;
      const matches = byContext.get(key) ?? [];
      matches.push(occurrence);
      byContext.set(key, matches);
    }
    const largest = [...byContext.values()].reduce((best, matches) => matches.length > best.length ? matches : best, [] as Occurrence[]);
    chooseGroup(group);
    setSelected(new Set(largest.map((item) => item.proposal_id)));
  }
  function familyAction(group: FamilyGroup, action: "confirm" | "correct" | "reject") {
    const occurrences = selectedGroup === group.signature ? group.occurrences.filter((item) => selected.has(item.proposal_id)) : [];
    if (!occurrences.length) return;
    void perform(async () => {
      const sources = await Promise.all([...new Set(occurrences.map((item) => item.ability_version_id))].map((id) => api<Ability>(`/abilities/${id}`)));
      const byId = new Map(sources.map((item) => [item.id, item]));
      const correction = action === "correct" ? parameters(familyCorrection.parameters) : null;
      const decisions = occurrences.map((item): Decision => {
        const source = byId.get(item.ability_version_id)!;
        const proposal = source.proposals.find((entry) => entry.id === item.proposal_id && pending(entry));
        if (source.source_hash !== item.source_hash || !proposal || proposal.family_id !== item.family_id || JSON.stringify(proposal.parameters) !== JSON.stringify(item.parameters)) {
          throw new Error("This occurrence or its semantic fingerprint changed. Reload Family mode before confirming it.");
        }
        return { ...proposalDecision(source, proposal, action), ...(correction ? {
          family_id: familyCorrection.family, family_version: Number(familyCorrection.version), role: familyCorrection.role, parameters: correction,
        } : {}) };
      });
      await apply(decisions); setSelected(new Set());
    });
  }
  function splitSelection(group: FamilyGroup) {
    if (!selected.size || selectedGroup !== group.signature) return;
    const signature = `${group.signature} / split ${crypto.randomUUID().slice(0, 8)}`;
    setFamilyPage((current) => ({ ...current, groups: current.groups.flatMap((entry) => {
      if (entry.signature !== group.signature) return [entry];
      const chosen = entry.occurrences.filter((item) => selected.has(item.proposal_id));
      const rest = entry.occurrences.filter((item) => !selected.has(item.proposal_id));
      if (!rest.length) return [entry];
      return [{ ...entry, occurrences: rest, count: entry.count - chosen.length }, { ...entry, signature, occurrences: chosen, count: chosen.length }];
    }) }));
    setSelectedGroup(signature);
    setStatus("Selected occurrences isolated for separate review on this page. No source decisions changed.");
  }

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable], [role='textbox']")) return;
      const key = event.key.toLowerCase();
      if (key === "?") { event.preventDefault(); setShortcuts((value) => !value); return; }
      if (busy || loading) return;
      if (key === "u" && canWrite && batches.length) { event.preventDefault(); undo(); }
      else if (key === "f") { event.preventDefault(); openFamily(); }
      else if (view === "abilities") {
        if (key === "j" || key === "k") { event.preventDefault(); navigateAbility(key === "j" ? 1 : -1); }
        else if (draft && canWrite && !reselecting && ["a", "r", "n", "b"].includes(key)) {
          const shortcutAction: Action | null = key === "a"
            ? connectiveProposal
              ? pendingConnectiveProposal && !draftChanged ? "confirm-connective" : null
              : supportsSemanticConfirmation ? approveAction : null
            : key === "r"
              ? (connectiveProposal || draft.kind === "proposal") && !draftChanged ? "reject" : null
              : !connectiveProposal && draft.kind !== "annotation" && !draftChanged
                ? key === "n" ? "novel" : "ambiguous"
                : null;
          if (shortcutAction) {
            event.preventDefault();
            decide(shortcutAction);
          }
        }
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });

  let selectedText = ""; let boundaryError = "";
  if (ability && draft) {
    try { selectedText = sourceSlice(ability, draft.fragment, Number(draft.start), Number(draft.end)); }
    catch (cause) { boundaryError = cause instanceof Error ? cause.message : String(cause); }
  }
  let draftParameters: Record<string, unknown> | null = null;
  if (draft) {
    try { draftParameters = parameters(draft.parameters); } catch { /* The JSON editor remains available for correction. */ }
  }
  const selectedFamily = families.find((item) => item.id === draft?.family && item.version === Number(draft.version));
  const characteristicReady = draft?.family !== "characteristic-set" || (draftParameters
    && ["bearer", "this-model", "this-unit"].includes(String(draftParameters.subject))
    && CHARACTERISTICS.includes(String(draftParameters.characteristic))
    && Number.isSafeInteger(draftParameters.value));
  const weaponReady = draft?.family !== "weapon-ability-grant" || (draftParameters
    && ["bearer", "this-model", "this-unit"].includes(String(draftParameters.subject))
    && selectedFamily?.parameterSchema.properties?.keyword?.enum?.includes(String(draftParameters.keyword))
    && selectedText.toLowerCase().includes(String(draftParameters.keyword).toLowerCase()));
  const fieldsReady = Boolean(selectedFamily && draftParameters && Object.entries(selectedFamily.starter).every(([name]) => {
    const schema = selectedFamily.parameterSchema.properties?.[name];
    return schema && parameterReady(draftParameters[name], schema, selectedText);
  }));
  const draftChanged = draft?.span && (draft.start !== String(draft.span.start_byte) || draft.end !== String(draft.span.end_byte)
    || draft.fragment !== draft.span.fragment || draft.family !== (draft.span.family_id ?? "") || draft.role !== draft.span.role
    || draft.version !== String(draft.span.family_version ?? 1) || draft.parameters !== JSON.stringify(draft.span.parameters ?? {}, null, 2));
  const stampEditorDirty = stampDefinition !== stampFormBaseline.definition
    || stampPositives !== stampFormBaseline.positives
    || stampCounterexamples !== stampFormBaseline.counterexamples;
  const editorDirty = Boolean(
    reselecting
    || draft?.kind === "selection"
    || draftChanged
    || dirtyCensusAbilityId !== null
    || stampReason.trim()
    || objectionResolution.trim()
    || workResponse.trim()
    || Object.values(escalationNotes).some((note) => note.trim().length > 0),
  );

  useEffect(() => {
    dirtyState.current = editorDirty;
    dirtyAbilityId.current = dirtyCensusAbilityId ?? (reselecting || draft?.kind === "selection" || draftChanged ? draft?.ability_id ?? null : null);
    selectedStampState.current = selectedStamp;
    stampPreviewState.current = stampPreview;
    stampEditorDirtyState.current = stampEditorDirty;
    selectedDraftState.current = selectedDraftId;
    stampPreviewCursorState.current = stampPreviewCursor;
  }, [editorDirty, dirtyCensusAbilityId, reselecting, draft, draftChanged, selectedStamp, stampPreview, stampEditorDirty, selectedDraftId, stampPreviewCursor]);

  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      if (document.visibilityState === "visible") void syncWorkbenchRevision(false);
    };
    const schedule = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "visible") {
        check();
        timer = window.setInterval(check, 2_000);
      }
    };
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", check);
    schedule();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", check);
    };
  }, []);
  const connectiveProposal = draft?.kind === "proposal" && draft.span?.role === "CONNECTIVE";
  const pendingConnectiveProposal = connectiveProposal && (draft?.span as Proposal).status === "pending";
  const supportsSemanticConfirmation = !connectiveProposal && Boolean(selectedFamily && selectedFamily.role === draft?.role && fieldsReady && characteristicReady && weaponReady);
  const approveAction = draft?.kind === "annotation" || draftChanged ? "correct" : "confirm";

  function panel(title: string, children: ReactNode, description?: string) {
    return <section className="wb-panel"><header className="wb-section-heading"><h1>{title}</h1>{description && <p>{description}</p>}</header>{children}</section>;
  }

  return <div className="wb-shell">
    <a className="wb-skip" href="#wb-main">Skip to review</a>
    <header className="wb-header">
      <div className="title-lockup"><span className="status-dot" aria-hidden="true" /><div><strong>Semantic workbench</strong><small>Round 5C · source-native review</small></div></div>
      <nav className="wb-tabs" aria-label="Workbench views">{VIEWS.map((item) => <button key={item.id} aria-current={view === item.id ? "page" : undefined}
        onClick={() => { setView(item.id); setError(null); }}>{item.label}</button>)}</nav>
      <a className="wb-legacy" href="/legacy">Legacy reviewer</a>
    </header>
    <aside className="wb-sidebar" aria-label="Ability page">
      <label htmlFor="wb-faction">Faction</label>
      <select id="wb-faction" value={faction} disabled={view === "abilities" && editorDirty} onChange={(event) => {
        setFaction(event.target.value); setCursors([null]); setFamilyCursors([null]); setFocused(null); setDraft(null);
      }}><option value="">All factions</option>{factions.map((id) => <option key={id} value={id}>{id}</option>)}</select>
      <form className="wb-search" onSubmit={(event) => {
        event.preventDefault(); setSearch(searchInput.trim()); setCursors([null]); setFocused(null); setDraft(null);
      }}>
        <label htmlFor="wb-search-input">Find a source ability</label>
        <input id="wb-search-input" type="search" maxLength={100} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Name, ID, or faction" />
        <button className="secondary" type="submit">Search</button>
        {search && <button className="quiet" type="button" onClick={() => {
          setSearchInput(""); setSearch(""); setCursors([null]); setFocused(null);
        }}>Clear search</button>}
      </form>
      <div className="wb-queue-filter" role="group" aria-label="Ability review state">
        <button className="secondary" aria-pressed={reviewState === "pending"} onClick={() => { setReviewState("pending"); setCursors([null]); setFocused(null); setDraft(null); setStatus("Showing abilities awaiting whole-context review."); }}>To review</button>
        <button className="secondary" aria-pressed={reviewState === "reviewed"} onClick={() => { setReviewState("reviewed"); setCursors([null]); setFocused(null); setDraft(null); setStatus("Showing completed whole-context reviews."); }}>Reviewed</button>
      </div>
      <div className="wb-queue-heading"><strong>{reviewState === "pending" ? "To review" : "Reviewed"} · page {cursors.length}</strong><span>{page.items.length} {page.items.length === 1 ? "ability" : "abilities"}</span></div>
      <nav className="wb-queue" aria-label="Complete abilities on this page">{page.items.map((item, index) => <button key={item.id} className={activeId === item.id ? "current" : ""}
        onClick={() => { setFocused(null); setView("abilities"); setActiveId(item.id); setDraft(null); requestAnimationFrame(() => document.getElementById(`wb-ability-${item.id}`)?.scrollIntoView({ block: "start" })); }}>
        <span className="wb-queue-index">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.name || item.ability_id}</strong><small>{item.faction_id}</small></span>
        <span className={`wb-queue-coverage${item.coverage.whole_reviewed ? " reviewed" : ""}`} title={item.coverage.whole_reviewed ? "Whole-context reviewed" : "Provisional leaf coverage"}>{percent(item.coverage.leaf_fraction)}</span>
      </button>)}</nav>
      <div className="wb-pagination"><button className="secondary" disabled={busy || loading || cursors.length === 1} onClick={() => { setFocused(null); setDraft(null); setCursors((current) => current.slice(0, -1)); }}>Previous</button>
        <button className="secondary" disabled={busy || loading || !page.next_cursor} onClick={() => { setFocused(null); setDraft(null); setCursors((current) => [...current, page.next_cursor]); }}>Next 12</button></div>
      <section className="wb-selection-set" aria-label="Uncovered review selection">
        <div className="wb-selection-heading"><strong>Selection set · {uncoveredSelection.length}</strong>
          {uncoveredSelection.length > 0 && <button className="text-button" onClick={() => setUncoveredSelection([])}>Clear</button>}</div>
        <button className="secondary" disabled={busy || loading || !page.items.some((item) => item.coverage.uncovered.length > 0)}
          onClick={() => stageUncovered(page.items)}>Add uncovered on this page</button>
        <p className="wb-help">Staged in this browser session across pages. Each region needs its own source review; staging does not confirm it.</p>
        <div className="wb-selection-items">{uncoveredSelection.map((entry) => <div key={uncoveredKey(entry)} className="wb-selection-item">
          <strong>{entry.ability_id}</strong><small>{entry.faction_id} · {entry.fragment} · {entry.start_byte}–{entry.end_byte}</small>
          <span title={entry.text}>{entry.text}</span>
          <div><button className="text-button" disabled={busy || editorDirty} onClick={() => inspectUncovered(entry)}>Inspect</button>
            <button className="text-button" onClick={() => setUncoveredSelection((current) => current.filter((item) => uncoveredKey(item) !== uncoveredKey(entry)))}>Remove</button></div>
        </div>)}</div>
      </section>
      <div className="wb-sidebar-foot"><button className="quiet" onClick={() => setShortcuts((value) => !value)} aria-expanded={shortcuts}>Shortcuts <kbd>?</kbd></button>
        <button className="secondary" disabled={!canWrite || !batches.length} onClick={undo}>Undo batch <kbd>U</kbd></button></div>
    </aside>
    <main id="wb-main" className={`wb-main${view === "abilities" ? " wb-main-abilities" : ""}`} aria-busy={loading || busy}>
      <div className="wb-feedback">
        {error
          ? <p role="alert" className="error">{error}</p>
          : externalNotice
            ? <p role="status" className="warning">{externalNotice}</p>
            : <p role="status">{busy ? "Recording decision…" : loading ? "Loading workbench records…" : status}</p>}
        <button className="text-button" disabled={busy} onClick={() => {
          setDraft(null);
          setCensusResetToken((value) => value + 1);
          setExternalNotice(null);
          setStampPreviewStale(false);
          setRevision((value) => value + 1);
          if (focused) void perform(async () => { await refreshAbilities([focused.id]); }, false);
        }}>Reload</button>
      </div>
      {shortcuts && <aside className="wb-shortcuts" aria-label="Keyboard shortcuts"><span><kbd>A</kbd> approve / correct</span><span><kbd>R</kbd> reject</span><span><kbd>N</kbd> novel</span><span><kbd>B</kbd> ambiguous</span><span><kbd>J</kbd>/<kbd>K</kbd> next / previous ability</span><span><kbd>F</kbd> Family mode</span><span><kbd>U</kbd> undo batch</span><span>Shortcuts pause in form fields.</span></aside>}
      {view === "abilities" && <>
        <div className="wb-page-heading"><div><p className="eyebrow">Ability mode</p><h1>Read the whole rule.</h1><p className="wb-help">Select exact source text to paint a leaf. Proposals are suggestions, never Goldens.</p></div>
          {focused && <button className="secondary" onClick={() => { setFocused(null); setDraft(null); setActiveId(page.items[0]?.id ?? null); }}>Return to 12-ability page</button>}
        </div>
        <div className="wb-legend" aria-label="Semantic highlight legend">{["condition", "event", "effect", "duration", "resource", "connective", "unresolved"].map((role) => <span key={role} className={`wb-role-${role}`}>{role}</span>)}<span className="wb-legend-proposal">outlined = proposal</span><span>muted = accepted interpretation</span></div>
        {loading && !visible.length && <div className="wb-loading" role="status">Loading 12 complete source records…</div>}
        {!loading && !visible.length && !error && <div className="wb-empty"><h2>{reviewState === "pending" ? "No abilities awaiting review" : "No reviewed abilities found"}</h2><p>{search ? "Try another search or switch review lists." : reviewState === "pending" ? "Check the Reviewed list for completed abilities. Initialize and refresh the local corpus if no source has been loaded." : "Completed whole-context checks appear here."}</p></div>}
        <div className="wb-review-layout"><div className="wb-reading-column">
          {visible.map((item) => <article id={`wb-ability-${item.id}`} key={`${item.id}:${item.source_hash}`} className={`wb-ability${activeId === item.id ? " inspected" : ""}`} aria-labelledby={`wb-title-${item.id}`}>
            <header className="wb-ability-heading"><div><p className="eyebrow">{item.faction_id} · {item.source_type || item.source_kind || "source"}</p><h2 id={`wb-title-${item.id}`}>{item.name || item.ability_id}</h2></div>
              <button className="quiet" aria-pressed={activeId === item.id} onClick={() => { setActiveId(item.id); setDraft(null); }}>Inspect ability</button></header>
            <div className="wb-coverage-line"><span>{percent(item.coverage.leaf_fraction)} accepted leaf</span><span>{percent(item.coverage.proposal_fraction)} proposed</span><span className={item.coverage.whole_reviewed ? "wb-reviewed" : ""}>{item.coverage.whole_reviewed ? "Whole reviewed" : "Provisional"}</span></div>
            <LeafProgressStrip progress={item.progress} />
            {item.fragments.map((fragment) => <SourceFragment key={fragment.fragment} ability={item} fragment={fragment} active={draft} inspect={inspect} select={select} />)}
            <details className="wb-uncovered"><summary>{item.coverage.uncovered.length} uncovered region{item.coverage.uncovered.length === 1 ? "" : "s"}</summary>
              {item.coverage.uncovered.map((region) => {
                const staged = uncoveredSelection.some((entry) => entry.ability_version_id === item.id && entry.source_hash === item.source_hash
                  && entry.fragment === region.fragment && entry.start_byte === region.start_byte && entry.end_byte === region.end_byte);
                return <div key={`${region.fragment}:${region.start_byte}`} className="wb-uncovered-row">
                  <button className="wb-region" onClick={() => select(item, region, region.start_byte, region.end_byte, region.text)}><small>{region.fragment} · {region.start_byte}–{region.end_byte}</small><span>{region.text}</span></button>
                  <button className="secondary" disabled={staged} onClick={() => stageUncovered([item], region)}>{staged ? "Staged" : "Add to selection"}</button>
                </div>;
              })}
              {!item.coverage.uncovered.length && <p className="wb-help">All reviewable bytes have leaf annotations. Whole-context review is still a separate judgment.</p>}
            </details>
          </article>)}
        </div>
        <aside ref={inspector} className="wb-inspector" aria-label="Source and span inspector">
          {ability ? <>
            <header><p className="eyebrow">Inspecting</p><h2>{ability.name || ability.ability_id}</h2></header>
            <details className="wb-provenance"><summary>Source provenance</summary><dl><dt>Identity</dt><dd>{ability.faction_id} / {ability.ability_id}</dd><dt>Kind / type</dt><dd>{ability.source_kind || "Unknown"} / {ability.source_type || "Unknown"}</dd><dt>Version</dt><dd>{ability.id}</dd><dt>Source hash</dt><dd><code>{ability.source_hash}</code></dd></dl></details>
            <section className="wb-ownership"><h3>Linked game data</h3>
              <p>{ability.context.wargear ? `Wargear: ${ability.context.wargear.name ?? ability.context.wargear.id}` : "No matching wargear record"}</p>
              <p>{ability.context.owners.length ? `Unit${ability.context.owners.length === 1 ? "" : "s"}: ${ability.context.owners.map((owner) => owner.name ?? owner.unit_id).join(", ")}` : "No linked core unit found"}</p>
              {ability.context.selection_budgets.map((budget, index) => <p key={`${budget.unit_id}:${index}`}>Selection budget: {budget.count} per {budget.per_models === 0 ? "unit" : `${budget.per_models} models`} ({budget.unit_id})</p>)}
              {ability.context.wargear?.options.map((option) => <p key={option.id}>Wargear option {option.id}{option.model_constraint ? ` · model constraint ${JSON.stringify(option.model_constraint)}` : ""}</p>)}
              <p className="wb-help">Equipment and selection limits are tracked core facts; they do not set a span’s semantic target. Check the source before choosing bearer or unit.</p>
              {ability.context.existing_dsl && <details><summary>Existing community-authored DSL (not this review)</summary>
                <p>Game version: {readable(ability.context.existing_dsl.game_version)}</p>
                <p>Effect</p><pre>{JSON.stringify(ability.context.existing_dsl.effect, null, 2)}</pre>
                <p>Scope</p><pre>{JSON.stringify(ability.context.existing_dsl.scope, null, 2)}</pre>
              </details>}</section>
            <SourceWorkPanel ability={ability}
              selection={draft && draft.ability_id === ability.id && draft.kind === "selection" && !boundaryError && selectedText
                ? { fragment: draft.fragment, start_byte: Number(draft.start), end_byte: Number(draft.end), exact_text: selectedText } : null}
              busy={!canWrite} perform={(work, expects) => void perform(work, expects)} reviewer={REVIEWER}
              onBatch={(batchId) => setBatches((current) => [...current, batchId])}
              onChanged={async () => { await refreshAbilities([ability.id]); }}
              onCompose={(escalationId) => { setView("work"); setWorkPurpose("propose-rule"); setWorkIds(escalationId); void perform(() => prepareAndRunWork("propose-rule", [escalationId])); }}
              setStatus={setStatus} />
            <div className="wb-span-list"><h3>Source spans</h3>{[...ability.annotations.map((span) => ({ span, kind: "annotation" as const })), ...ability.proposals.filter(pending).map((span) => ({ span, kind: "proposal" as const }))].map(({ span, kind }) => <button key={`${kind}-${span.id}`} className={`wb-span-row${draft?.span?.id === span.id && draft.kind === kind ? " current" : ""}`} onClick={() => inspect(ability, span, kind)}>
              <span>{span.exact_text}</span><small>{kind === "annotation" ? span.authority_kind === "stamp" ? "Rule-derived" : "Confirmed" : "Proposal"} · {span.role} · {span.start_byte}–{span.end_byte}</small></button>)}
              {!ability.annotations.length && !ability.proposals.filter(pending).length && <p className="wb-help">Select a source phrase to create a grounded annotation or flag a leaf gap.</p>}
            </div>
            {draft && draft.ability_id === ability.id && <section className="wb-editor" aria-labelledby="wb-edit-title"><h3 id="wb-edit-title">{draft.kind === "annotation" ? (draft.span as Annotation).authority_kind === "stamp" ? "Correct rule-derived span" : "Correct confirmed span" : draft.kind === "proposal" ? "Review proposal" : "Paint selected source"}</h3>
              {boundaryError ? <p className="error" role="alert">{boundaryError}</p> : <blockquote>{selectedText}</blockquote>}
              <div className="wb-editor-grid"><label>Fragment<select value={draft.fragment} onChange={(event) => editDraft({ fragment: event.target.value })}>{ability.fragments.map((fragment) => <option key={fragment.fragment}>{fragment.fragment}</option>)}</select></label>
                {connectiveProposal
                  ? <label>Role<input value="CONNECTIVE" readOnly /></label>
                  : <label>Role<select value={draft.role} onChange={(event) => {
                    const role = event.target.value;
                    editDraft(families.some((item) => item.id === draft.family && item.role === role)
                      ? { role } : { role, family: "", version: "1", parameters: "{}" });
                  }}>{[...ROLES, "UNRESOLVED"].map((role) => <option key={role} value={role}>{role === "UNRESOLVED" ? "Unresolved: record a gap" : ROLE_LABELS[role as Role]}</option>)}</select></label>}</div>
              <div className="wb-boundary-tools"><button type="button" className="secondary" aria-pressed={reselecting} onClick={() => {
                if (reselecting) { setReselecting(false); return; }
                setReselecting(true); setError(null);
                requestAnimationFrame(() => document.getElementById(`wb-fragment-${ability.id}-${draft.fragment}`)?.scrollIntoView({ block: "center" }));
              }}>{reselecting ? "Cancel reselection" : "Reselect source text"}</button>
                <p className="wb-help">{reselecting ? "Select the replacement text in this source fragment. Your role, family, and proposal stay attached; no decision is recorded yet." : "Drag across the exact source words to adjust the span. Review the highlighted result before confirming."}</p>
                <details><summary>Advanced: byte offsets ({draft.start}–{draft.end})</summary><div className="wb-editor-grid">
                  <label>Start byte<input type="number" min={0} value={draft.start} onChange={(event) => editDraft({ start: event.target.value })} /></label><label>End byte (exclusive)<input type="number" min={1} value={draft.end} onChange={(event) => editDraft({ end: event.target.value })} /></label>
                </div></details></div>
              {!connectiveProposal && <><label>Reviewed family<select value={draft.family} onChange={(event) => {
                const choice = families.find((item) => item.id === event.target.value && item.role === draft.role);
                editDraft({ family: choice?.id ?? "", version: String(choice?.version ?? 1), parameters: JSON.stringify(choice?.starter ?? {}, null, 2) });
              }}><option value="">Choose what this {draft.role.toLowerCase()} means</option>
                {families.filter((item) => item.role === draft.role).map((item) => <option key={`${item.id}@${item.version}`} value={item.id}>{item.label}</option>)}
              </select></label>
                {selectedFamily && <p className="wb-help">{selectedFamily.description} <code>{selectedFamily.id}@{selectedFamily.version}</code></p>}
                {draft.role === "CONDITION" && <p className="wb-help">Mark the condition separately from its effect. A reviewed condition family must express the entire condition, including named-model qualifiers; otherwise record Novel or Ambiguous.</p>}
                {draft.family === "critical-hit-threshold" && <p className="wb-help">Critical hits are not the same as hits scored. If this text only changes which unmodified Hit rolls score hits, do not confirm it as a critical-hit threshold.</p>}
                {draft.family === "characteristic-set" && <><div className="wb-editor-grid">
                  <label>Subject<select value={String(draftParameters?.subject ?? "")} onChange={(event) => editParameter("subject", event.target.value)}><option value="bearer">Bearer</option><option value="this-model">This model</option><option value="this-unit">This unit</option></select></label>
                  <label>Characteristic<select value={String(draftParameters?.characteristic ?? "")} onChange={(event) => editParameter("characteristic", event.target.value)}><option value="">Choose a characteristic</option>{CHARACTERISTICS.map((stat) => <option key={stat} value={stat}>{stat}</option>)}</select></label>
                  <label>Set to<input type="number" step={1} value={typeof draftParameters?.value === "number" ? draftParameters.value : ""} onChange={(event) => editParameter("value", event.target.value === "" ? null : Number(event.target.value))} placeholder="Numeric value from source" /></label>
                </div><p className="wb-help">Sets the named characteristic; it does not add to a roll. Select the exact source region, including the bearer or other subject. The Save value 3 represents 3+ in the source. Source-qualified values can be entered in JSON.</p></>}
                {draft.family === "weapon-ability-grant" && <><div className="wb-editor-grid">
                  <label>Whose weapons?<select value={String(draftParameters?.subject ?? "")} onChange={(event) => editParameter("subject", event.target.value)}>
                    <option value="this-unit">Models in this unit</option><option value="this-model">This model</option><option value="bearer">Bearer</option>
                  </select></label>
                  <label>Weapon ability<select value={String(draftParameters?.keyword ?? "")} onChange={(event) => editParameter("keyword", event.target.value)}>
                    <option value="">Choose the ability named in the source</option>
                    {selectedFamily?.parameterSchema.properties?.keyword?.enum?.map((keyword) => <option key={keyword} value={keyword}>{keyword}</option>)}
                  </select></label>
                </div><p className="wb-help">This grants an ability to weapons, not to the unit. Select the exact effect clause; review a condition or named-model qualifier as a separate source span.</p>
                {draftParameters?.keyword && !weaponReady && <p className="wb-help error">The chosen weapon ability must occur in the selected source text.</p>}</>}
                {selectedFamily && !["characteristic-set", "weapon-ability-grant"].includes(draft.family) && <div className="wb-editor-grid">
                  {Object.entries(selectedFamily.starter).map(([name]) => {
                    const property = selectedFamily.parameterSchema.properties?.[name];
                    if (!property) return null;
                    const choices = choicesFor(property);
                    const numeric = property.type === "integer" || property.anyOf?.some((item) => item.type === "integer");
                    const source = property.type === "object" || property.anyOf?.some((item) => item.type === "object");
                    const value = draftParameters?.[name];
                    return <label key={name}>{name.replaceAll("-", " ")}
                      {choices.length ? <select value={typeof value === "string" ? value : ""} onChange={(event) => editParameter(name, event.target.value)}>
                        <option value="">Choose {name.replaceAll("-", " ")}</option>{choices.map((choice) => <option key={choice} value={choice}>{choice.replaceAll("-", " ")}</option>)}
                      </select> : <input type={numeric && !source ? "number" : "text"} step={numeric ? 1 : undefined}
                        value={source && value && typeof value === "object" && "source" in value ? String(value.source) : typeof value === "number" || typeof value === "string" ? value : ""}
                        onChange={(event) => editParameter(name, source ? { source: event.target.value } : numeric && event.target.value !== "" ? Number(event.target.value) : event.target.value || null)}
                        placeholder={source ? "Exact words from selection" : numeric ? "Value from source" : name} />}
                    </label>;
                  })}
                </div>}
                {draftParameters && ((draft.family === "characteristic-set" && characteristicReady) || (draft.family === "weapon-ability-grant" && weaponReady)) && dslLeafPreview(draft.family, draftParameters)
                  && <div className="wb-family-fingerprint"><strong>Equivalent single DSL effect (preview only)</strong><pre>{JSON.stringify(dslLeafPreview(draft.family, draftParameters), null, 2)}</pre><small>This review does not write DSL or establish surrounding conditions.</small></div>}
                <details><summary>Parameters JSON · advanced</summary><textarea rows={5} spellCheck={false} value={draft.parameters} onChange={(event) => editDraft({ parameters: event.target.value })} /></details>
                <label className="wb-check"><input type="checkbox" checked={draft.overlap} onChange={(event) => editDraft({ overlap: event.target.checked })} /><span>Approve shared qualifier / containment with a different role</span></label></>}
              {draft.span && <details><summary>Span evidence and provenance</summary><dl><dt>Origin</dt><dd>{draft.span.origin}</dd><dt>Decision / proposal</dt><dd>{draft.span.id}</dd>
                {draft.kind === "annotation" && <><dt>{(draft.span as Annotation).authority_kind === "stamp" ? "Rule authorized by" : "Confirmed by"}</dt><dd>{(draft.span as Annotation).rule_authorized_by ?? (draft.span as Annotation).confirmed_by}</dd></>}
                {draft.kind === "proposal" && <><dt>Status</dt><dd>{(draft.span as Proposal).status}</dd><dt>Score</dt><dd>{(draft.span as Proposal).score ?? "Unknown"}</dd><dt>Reason</dt><dd><pre>{readable((draft.span as Proposal).reason)}</pre></dd></>}
              </dl></details>}
              <div className="wb-decision-actions">{connectiveProposal ? <>{pendingConnectiveProposal && <button className="primary" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("confirm-connective")}>Confirm connective <kbd>A</kbd></button>}
                <button className="secondary danger" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("reject")}>Reject <kbd>R</kbd></button></> : <><button className="primary" disabled={!canWrite || reselecting || !!boundaryError || !supportsSemanticConfirmation} onClick={() => decide(approveAction)}>{approveAction === "correct" ? "Apply correction" : "Confirm leaf"} <kbd>A</kbd></button>
                {draft.kind === "proposal" && <button className="secondary danger" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("reject")}>Reject <kbd>R</kbd></button>}
                {draft.kind !== "annotation" && <><button className="secondary" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("novel")}>Novel <kbd>N</kbd></button><button className="secondary" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("ambiguous")}>Ambiguous <kbd>B</kbd></button></>}</>}</div>
              <p className="wb-help">{connectiveProposal ? pendingConnectiveProposal ? "Connectives are reviewed source relations, not semantic fingerprints. Confirm or reject this pending connective without changing its source bytes." : "This connective is no longer pending and can only be rejected if it remains reviewable." : draft.kind === "annotation" ? "Accepted spans allow corrections. A correction supersedes this exact interpretation; use batch undo to retract a recent human confirmation." : draftChanged ? "Edited proposals must be applied as corrections. Reopen the original span to reject or flag it instead." : "Unresolved proposals can be rejected, assigned a reviewed family, or recorded as novel or ambiguous leaf gaps."}</p>
              {!connectiveProposal && <button className="text-button" disabled={!supportsSemanticConfirmation} onClick={() => openFamily()}>Open this family <kbd>F</kbd></button>}
              {draft.kind === "annotation" && (draft.span as Annotation).authority_kind === "human"
                ? <button className="secondary" disabled={!canWrite || reselecting || !!draftChanged} onClick={() => createLiteralStamp(draft.span as Annotation)}>Create stamp from confirmed span</button>
                : draft.kind === "annotation"
                  ? <p className="wb-help">Rule-derived occurrences cannot seed another literal rule. Select a current human-confirmed span instead.</p>
                  : null}
            </section>}
            <section className="wb-bulk"><button className="secondary" disabled={!canWrite || !safeProposals.length} onClick={() => void perform(() => apply(safeProposals.map((proposal) => proposalDecision(ability, proposal, "confirm"))))}>Confirm {safeProposals.length} nonconflicting proposals</button><p className="wb-help">Only this inspected ability. Overlapping proposals and unregistered regions are excluded. This does not check whole context.</p></section>
            <ReviewCensus key={`${ability.id}:${censusResetToken}`} ability={ability} disabled={!canWrite} onDirtyChange={setDirtyCensusAbilityId} save={(checked, shape, cues, expectedReviewHash) => void perform(async () => {
              const updated = await api<Ability>(`/abilities/${ability.id}/review`, { source_hash: ability.source_hash, expected_review_hash: expectedReviewHash, reviewer: REVIEWER, whole_context_checked: checked, ...(shape.trim() ? { source_shape: shape.trim() } : {}), cues: parameters(cues) });
              setDirtyCensusAbilityId(null); setDraft(null); setRevision((value) => value + 1);
              if (checked && updated.progress.readiness.composition_eligible) {
                // Keep the checked source in view: its composition gap is the next action.
                setFocused(updated);
                setStatus("Whole-context check recorded and a composition gap opened. Use Next up to generate a composition proposal.");
              } else {
                setStatus(checked ? "Whole-context check recorded." : "Whole-context check cleared. This ability moved to To review.");
                setFocused(null);
                setPage((current) => ({ ...current, items: current.items.filter((item) => item.id !== updated.id) }));
              }
            })} />
          </> : <p className="wb-help">Choose an ability to inspect source provenance, span decisions, and whole-context review.</p>}
        </aside></div>
      </>}
      {view === "family" && panel("Family mode", <>
        <label className="wb-family-picker">Reviewed family<select value={family} onChange={(event) => { setFamily(event.target.value); setFamilySignature(null); setFamilyCursors([null]); setSelected(new Set()); }}><option value="">Choose a family</option>{families.map((item) => <option key={`${item.id}@${item.version}`} value={item.id}>{ROLE_LABELS[item.role]} · {item.label}</option>)}</select></label>
        <p className="wb-help">Matching phrases and source-native fingerprints share a block. Select from this page, then inspect each source context before applying a decision. A fingerprint is not an authored DSL graph.</p>
        {family && familySignature && <div className="wb-actions"><p className="wb-help">Showing one group from the work queue.</p><button className="secondary" onClick={() => { setFamilySignature(null); setFamilyCursors([null]); }}>Show every {family} group</button></div>}
        {family && !loading && <div className="wb-family-progress">
          <div><strong>{family} review</strong><span>{familyPage.progress.reviewed} of {familyPage.progress.total} retrieved candidates reviewed</span></div>
          <progress aria-label={`${family} candidate review progress`} value={familyPage.progress.reviewed} max={Math.max(familyPage.progress.total, 1)} />
          <p className="wb-help">Accepted, rejected, and corrected candidates count as reviewed. New retrievals can increase the total.</p>
        </div>}
        {family && !loading && !familyPage.groups.length && <div className="wb-empty"><h2>{familySignature ? "This group is reviewed" : familyPage.progress.total > 0 && familyPage.progress.reviewed === familyPage.progress.total ? "All current candidates reviewed" : "No pending candidates for this family"}</h2><p>{familySignature ? "Show every group to continue reviewing this family." : "Confirm a grounded leaf in Ability mode to retrieve more occurrences."}</p></div>}
        {familyPage.groups.map((group) => {
          const first = group.occurrences[0]!;
          const selectedOccurrences = selectedGroup === group.signature ? group.occurrences.filter((item) => selected.has(item.proposal_id)) : [];
          const selectedCount = selectedOccurrences.length;
          const preview = dslLeafPreview(first.family_id, first.parameters);
          return <section className="wb-family-group" key={group.signature}>
            <header><div><h2>{first.exact_text}</h2><p>{group.count} occurrences · {group.context_count} distinct {group.context_count === 1 ? "context" : "contexts"} · {group.occurrences.length} on this page</p></div></header>
            <div className="wb-family-fingerprint"><strong>Source-native fingerprint: {first.family_id}@{first.family_version} · {first.role}</strong>
              <pre>{JSON.stringify(first.parameters, null, 2)}</pre><details><summary>Fingerprint provenance</summary><code>{first.fingerprint_id}</code></details>
              {preview ? <div className="wb-dsl-preview"><strong>Equivalent single DSL effect for these parameters</strong><pre>{JSON.stringify(preview, null, 2)}</pre><p>This is a shape preview only; confirmation does not write DSL or establish surrounding conditions.</p></div>
                : <p>No verified one-to-one DSL leaf is displayed. Confirming records the source-native fingerprint, not a DSL effect.</p>}</div>
            <div className="wb-family-toolbar">
              <div className="wb-family-selection">
                <label className="wb-check"><input type="checkbox" disabled={busy || loading} checked={selectedCount === group.occurrences.length}
                  ref={(node) => { if (node) node.indeterminate = selectedCount > 0 && selectedCount < group.occurrences.length; }}
                  onChange={(event) => { chooseGroup(group); setSelected(new Set(event.target.checked ? group.occurrences.map((item) => item.proposal_id) : [])); }} />
                  <span>Select all {group.occurrences.length} on this page</span></label>
                {group.occurrences.length > 1 && <button className="secondary" disabled={busy || loading} onClick={() => selectMatchingContext(group)}>Select largest shared context</button>}
                <span aria-live="polite">{selectedCount} selected</span>
              </div>
              {new Set(selectedOccurrences.map((item) => `${item.context_signature}\u0000${item.context}`)).size > 1 && <p className="wb-help">Selected occurrences have different surrounding source; inspect them below before applying a shared decision.</p>}
              <div className="wb-actions">
                <button className="primary" disabled={!canWrite || !selectedCount} onClick={() => familyAction(group, "confirm")}>{busy ? `Recording ${selectedCount}…` : `Confirm ${selectedCount}`}</button>
                <button className="secondary danger" disabled={!canWrite || !selectedCount} onClick={() => familyAction(group, "reject")}>Reject selected</button>
                <button className="secondary" disabled={busy || !selectedCount || selectedCount === group.occurrences.length} onClick={() => splitSelection(group)}>Split selected</button>
                {group.count >= 2 && (group.stamp_seed_annotation_id !== null
                  ? <button className="secondary" disabled={!canWrite} onClick={() => proposeSeededStamp(group.stamp_seed_annotation_id!)}>Propose leaf stamp from existing seed</button>
                  : <button className="secondary" disabled={!canWrite || selectedCount > 1} onClick={() => confirmOneAndProposeStamp(group)}>Confirm one and propose leaf stamp</button>)}
              </div>
              {group.count >= 2 && <p className="wb-help">{group.count} pending in total; only the stamp's corpus preview decides which are eligible, already satisfied, or blocked.</p>}
              {selectedCount > 0 && error && <p role="alert" className="error">{error}</p>}
            </div>
            <div className="wb-family-correction"><details><summary>Correct family and parameters for selected occurrences</summary>
              <div className="wb-editor-grid"><label>Role<select value={selectedGroup === group.signature ? familyCorrection.role : first.role} onChange={(event) => {
                chooseGroup(group);
                setFamilyCorrection({ family: "", role: event.target.value, version: "1", parameters: "{}" });
              }}>{ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></label>
                <label>Family<select value={selectedGroup === group.signature ? familyCorrection.family : first.family_id} onChange={(event) => {
                  chooseGroup(group);
                  const choice = families.find((item) => item.id === event.target.value);
                  if (choice) setFamilyCorrection({ family: choice.id, role: choice.role, version: String(choice.version), parameters: JSON.stringify(choice.starter, null, 2) });
                }}><option value="">Choose a family</option>{families.filter((item) => item.role === (selectedGroup === group.signature ? familyCorrection.role : first.role)).map((item) =>
                  <option key={`${item.id}@${item.version}`} value={item.id}>{item.label}</option>)}</select></label>
                <label>Version<input type="number" min={1} value={selectedGroup === group.signature ? familyCorrection.version : first.family_version} onChange={(event) => { chooseGroup(group); setFamilyCorrection((current) => ({ ...current, version: event.target.value })); }} /></label></div>
              <label>Parameters JSON<textarea value={selectedGroup === group.signature ? familyCorrection.parameters : JSON.stringify(first.parameters, null, 2)} rows={4} onChange={(event) => { chooseGroup(group); setFamilyCorrection((current) => ({ ...current, parameters: event.target.value })); }} spellCheck={false} /></label>
              <button className="secondary" disabled={!canWrite || !selectedCount || !familyCorrection.family} onClick={() => familyAction(group, "correct")}>Apply correction to {selectedCount}</button></details></div>
            {group.occurrences.map((item) => <div key={item.proposal_id} className="wb-occurrence"><label className="wb-check"><input type="checkbox" disabled={busy || loading} checked={selectedGroup === group.signature && selected.has(item.proposal_id)} onChange={(event) => toggleOccurrence(group, item.proposal_id, event.target.checked)} /><span><strong>{item.ability_id}</strong><small>{item.faction_id} · {item.fragment} · bytes {item.start_byte}–{item.end_byte} · <span className="wb-origin">{item.origin}</span></small></span></label><button className="text-button" disabled={busy} onClick={() => openAbility(item.ability_version_id, item.proposal_id)}>Inspect whole ability</button>
              <p className="wb-family-context">{item.context.slice(0, item.context_start)}<mark className={`wb-paint wb-role-${item.family_id === "resource-action" ? "resource" : item.role.toLowerCase()} wb-proposal`} title={`Unconfirmed proposal: ${item.role}. Bytes ${item.start_byte}–${item.end_byte}`}>{item.context.slice(item.context_start, item.context_end)}</mark>{item.context.slice(item.context_end)}</p></div>)}
          </section>;
        })}
        {family && <div className="wb-pagination"><button className="secondary" disabled={busy || loading || familyCursors.length === 1} onClick={() => setFamilyCursors((current) => current.slice(0, -1))}>Previous groups</button><button className="secondary" disabled={busy || loading || !familyPage.next_cursor} onClick={() => setFamilyCursors((current) => [...current, familyPage.next_cursor])}>Next occurrences</button></div>}
      </>, "Propagate source-bound decisions, not text collisions.")}
      {view === "compose" && panel("Ready for composition", <>
        {Object.values(workJobs).length > 0 && <div className="wb-import-report"><h3>Background runs</h3>{Object.values(workJobs).map((job) => <div key={job.run_id}>
          <strong>Run {job.run_id}</strong> <span className={`wb-state wb-state-${job.state === "completed" ? "approved" : job.state === "failed" ? "blocked" : "proposed"}`}>{job.state === "running" ? "running…" : job.state}</span>
          <p>{job.state === "completed" && job.report ? `${job.report.imported} imported, ${job.report.failed} failed` : job.state === "failed" ? job.error : `started ${new Date(job.started_at).toLocaleTimeString()}`}</p>
        </div>)}</div>}
        <CompositionQueuePanel faction={faction} busy={!canWrite} perform={(work, expects) => void perform(work, expects)} reviewer={REVIEWER}
          revision={revision} openAbility={openAbility} onRunsStarted={trackWorkRuns} setStatus={setStatus}
          openStamp={(stampId, stampRevision) => { setView("stamps"); chooseStamp({ id: stampId, revision: stampRevision }); }} />
      </>, "Check fully reviewed sources in bulk, then fire composition proposals for a selected block.")}
      {view === "ontology" && panel("Provisional families", <OntologyPanel faction={faction} busy={!canWrite} perform={(work, expects) => void perform(work, expects)}
        reviewer={REVIEWER} revision={revision} onBatch={(batchId) => setBatches((current) => [...current, batchId])} openAbility={openAbility} setStatus={setStatus} />,
        "Novel source forms grouped as hypotheses. Judgments are per occurrence; a new family needs a code change.")}
      {view === "stamps" && panel("Reusable stamps", <>
        <div className="wb-registry-toolbar">
          <label>Status<select value={stampStatus} onChange={(event) => { setStampStatus(event.target.value); setStampCursors([null]); }}>
            <option value="">All states</option>
            {["proposed", "approved", "suspended", "rejected", "superseded"].map((state) => <option key={state}>{state}</option>)}
          </select></label>
          <button className="secondary" disabled={busy} onClick={() => void perform(async () => {
            const result = await api<{ applied: number; already_satisfied: number; blocked: number }>("/stamps/apply", {});
            setStatus(`Reconciled approved stamps: ${result.applied} applied, ${result.already_satisfied} already satisfied, ${result.blocked} blocked.`);
          })}>Reconcile approved stamps</button>
        </div>
        <div className="wb-registry-layout">
          <aside className="wb-registry-list" aria-label="Stamp revisions">
            <p className="wb-help">{stampPage.total} revisions across the corpus. Each page is capped at 20.</p>
            {stampPage.items.map((item) => <button key={`${item.id}@${item.revision}`} className={selectedStamp?.id === item.id && selectedStamp.revision === item.revision ? "current" : ""}
              onClick={() => chooseStamp(item)}>
              <span><strong>{String(item.definition.label ?? item.id)}</strong><small>{item.id}@{item.revision} · {item.kind}</small></span>
              <span className={`wb-state wb-state-${item.status}`}>{item.status}</span>
            </button>)}
            {!registryLoading && !stampPage.items.length && <p className="wb-help">No stamp revisions match this state. Create one from a human-confirmed span in Ability mode.</p>}
            <div className="wb-pagination"><button className="secondary" disabled={busy || stampCursors.length === 1} onClick={() => setStampCursors((current) => current.slice(0, -1))}>Previous 20</button>
              <button className="secondary" disabled={busy || !stampPage.next_cursor} onClick={() => setStampCursors((current) => [...current, stampPage.next_cursor])}>Next 20</button></div>
          </aside>
          <section className="wb-registry-detail">
            {stampDetail ? <>
              <header className="wb-detail-heading"><div><p className="eyebrow">{stampDetail.kind} stamp · revision {stampDetail.revision}</p><h2>{stampDetail.definition.label}</h2></div><span className={`wb-state wb-state-${stampDetail.status}`}>{stampDetail.status}</span></header>
              <section className="wb-stamp-decision" aria-label="Stamp approval decision">
                <div className="wb-stamp-decision-facts">
                  {stampPreview
                    ? <p><strong>{stampPreview.totals.eligible}</strong> eligible · <strong>{stampPreview.totals.already_satisfied}</strong> already satisfied · <strong>{stampPreview.totals.blocked}</strong> blocked across the corpus</p>
                    : <p className="wb-help">Checking corpus-wide matches…</p>}
                  {stampDetail.approval_eligibility.challenge.required && <span className={`wb-state wb-state-${CHALLENGE_LABELS[stampDetail.approval_eligibility.challenge.state].tone}`}>Challenge {CHALLENGE_LABELS[stampDetail.approval_eligibility.challenge.state].label}</span>}
                  {stampPreviewStale && <span className="wb-state wb-state-blocked">Evidence changed</span>}
                </div>
                {(stampDetail.status === "proposed" || stampDetail.status === "suspended") && stampDetail.approval_eligibility.blocker && <p className="wb-help">{stampDetail.approval_eligibility.blocker.message}{stampDetail.approval_eligibility.blocker.next_action === "resolve-objection" ? " Record an objection resolution below to override it." : ""}</p>}
                {(stampDetail.status === "proposed" || stampDetail.status === "approved") && <label>Decision reason<input value={stampReason} onChange={(event) => setStampReason(event.target.value)} placeholder="Required for reject or suspend" /></label>}
                {stampDetail.approval_eligibility.challenge.state === "objection" && <label>Objection resolution (when overriding a model objection)<textarea rows={3} value={objectionResolution} onChange={(event) => setObjectionResolution(event.target.value)} /></label>}
                <div className="wb-decision-actions">
                  {(stampDetail.status === "proposed" || stampDetail.status === "suspended") && <button className="primary" disabled={!canWrite || !stampPreview || stampPreviewStale || stampEditorDirty || !approvalReady(stampDetail.approval_eligibility, objectionResolution)} onClick={approveSelectedStamp}>{stampPreview ? `Approve rule and apply to ${stampPreview.totals.eligible} matches` : "Approve rule (checking corpus)"}</button>}
                  {stampDetail.status === "proposed" && <button className="secondary danger" disabled={!canWrite || !stampReason.trim()} onClick={rejectSelectedStamp}>Reject proposal</button>}
                  {stampDetail.status === "approved" && <button className="secondary danger" disabled={!canWrite || stampPreviewStale || !stampReason.trim()} onClick={suspendSelectedStamp}>Suspend rule authority</button>}
                  {stampDetail.kind === "leaf" && stampDetail.status === "proposed" && stampPreview && stampPreview.totals.eligible === 0 && <button className="secondary" disabled={busy} onClick={escalateSelectedStamp}>Escalate to a same-family model rule</button>}
                  {stampDetail.approval_eligibility.challenge.required && <button className={stampDetail.approval_eligibility.approvable ? "secondary" : "primary"} disabled={busy} onClick={() => prepareChallengeWork(stampDetail)}>{stampDetail.approval_eligibility.challenge.state === "missing" ? "Prepare independent challenge" : "Prepare another challenge run"}</button>}
                </div>
              </section>
              <StampRuleReview definition={stampDetail.definition} positives={stampDetail.positives} inspectSource={openAbility} />
              <details className="wb-rule-provenance"><summary>Provenance and definition hash</summary>
                <dl className="wb-inline-facts"><div><dt>Stamp ID</dt><dd><code>{stampDetail.id}</code></dd></div><div><dt>Definition hash</dt><dd><code>{stampDetail.definition_hash}</code></dd></div><div><dt>Model proposal</dt><dd>{stampDetail.model_run_id ?? "No"}</dd></div><div><dt>Challenge run</dt><dd>{stampDetail.challenge_run_id ?? "Not recorded"}</dd></div></dl>
              </details>
              {stampDetail.challenge && <details><summary>Challenge findings</summary><pre className="wb-artifact">{JSON.stringify(stampDetail.challenge, null, 2)}</pre></details>}
              <details className="wb-rule-editor" open={stampEditorDirty}><summary>Revise definition and evidence</summary>
                <label>Closed stamp definition JSON<textarea rows={16} value={stampDefinition} onChange={(event) => setStampDefinition(event.target.value)} spellCheck={false} /></label>
                <div className="wb-editor-grid"><label>Positive source evidence JSON<textarea rows={8} value={stampPositives} onChange={(event) => setStampPositives(event.target.value)} spellCheck={false} /></label>
                  <label>Counterexamples JSON<textarea rows={8} value={stampCounterexamples} onChange={(event) => setStampCounterexamples(event.target.value)} spellCheck={false} /></label></div>
                <button className="secondary" disabled={!canWrite || !stampEditorDirty} onClick={proposeStampRevision}>Propose revision</button>
              </details>
              <div className="wb-actions">
                <button className="secondary" disabled={busy || stampEditorDirty} onClick={() => { setStampPreviewCursors([null]); void perform(() => loadStampPreview(null), false); }}>Preview all corpus matches</button>
                {stampDetail.status === "approved" && <button className="secondary" disabled={busy} onClick={() => {
                  setStampAuditCursors([null]);
                  void perform(() => loadStampAudit(null), false);
                }}>Load optional audit sample</button>}
              </div>
              {stampPreview && <section className={`wb-preview${stampPreviewStale ? " stale" : ""}`} aria-label="Stamp corpus preview">
                <header><div><h3>Corpus-wide preview</h3><p>{stampPreview.totals.eligible} eligible · {stampPreview.totals.already_satisfied} already satisfied · {stampPreview.totals.blocked} blocked</p></div>{stampPreviewStale && <span className="wb-state wb-state-blocked">Evidence changed</span>}</header>
                <p className="wb-help">Approval uses this corpus-wide hash across every page, not only the representative occurrences below.</p>
                <dl className="wb-inline-facts"><div><dt>Preview hash</dt><dd><code>{stampPreview.preview_hash}</code></dd></div><div><dt>Dependent drafts</dt><dd>{stampPreview.dependent_drafts.length}</dd></div></dl>
                <details><summary>{stampPreview.parameter_combinations.length} observed parameter combinations</summary><pre>{JSON.stringify(stampPreview.parameter_combinations, null, 2)}</pre></details>
                <div className="wb-preview-examples">{stampPreview.examples.map((example) => <article key={example.occurrence_id}><header><strong>Ability version {example.ability_version_id}</strong><span className={`wb-state wb-state-${example.status}`}>{example.status}</span></header><blockquote>{example.exact_text}</blockquote><small>{example.fragment} · bytes {example.start_byte}–{example.end_byte} · {example.variant_id}{example.reason_code ? ` · ${example.reason_code}` : ""}</small><details><summary>Bindings and output</summary><pre>{JSON.stringify({ bindings: example.bindings, output: example.output }, null, 2)}</pre></details></article>)}</div>
                <div className="wb-pagination"><button className="secondary" disabled={busy || stampPreviewCursors.length === 1} onClick={() => {
                  const next = stampPreviewCursors.slice(0, -1); setStampPreviewCursors(next); void perform(() => loadStampPreview(next[next.length - 1]), false);
                }}>Previous examples</button><button className="secondary" disabled={busy || !stampPreview.next_cursor} onClick={() => {
                  const next = [...stampPreviewCursors, stampPreview.next_cursor]; setStampPreviewCursors(next); void perform(() => loadStampPreview(next[next.length - 1]), false);
                }}>Next examples</button></div>
              </section>}
              {stampAudit && <section className="wb-preview" aria-label="Optional stamp audit sample">
                <header><div><h3>Optional reproducible audit</h3><p>{stampAudit.coverage.selected} selected from {stampAudit.coverage.applications} active applications · {stampAudit.coverage.strata} strata</p></div><span className="wb-state wb-state-approved">Optional</span></header>
                <p className="wb-help">This deterministic sample covers observed variants, enum combinations, numeric extrema, and neighboring contexts. It is not an approval queue, an exhaustive audit, or a statistical accuracy bound.</p>
                <details><summary>Audit stratum coverage</summary><MetricValue value={stampAudit.coverage} /></details>
                <div className="wb-preview-examples">{stampAudit.items.map((item) => <article key={item.application_id}>
                  <header><strong>{item.faction_id}/{item.ability_id}</strong>{item.latest_audit && <span className={`wb-state wb-state-${item.latest_audit.verdict === "correct" ? "approved" : "blocked"}`}>{item.latest_audit.verdict}{item.latest_audit.scope ? ` · ${item.latest_audit.scope}` : ""}</span>}</header>
                  <blockquote>{item.exact_text}</blockquote>
                  <small>{item.fragment} · bytes {item.start_byte}–{item.end_byte} · variant {item.variant_id}</small>
                  <details><summary>Neighboring source and audit strata</summary><pre>{JSON.stringify({ neighboring_context: item.neighboring_context, strata: item.strata, bindings: item.bindings }, null, 2)}</pre></details>
                  <div className="wb-decision-actions">
                    <button className="secondary" disabled={!canWrite} onClick={() => recordAudit(item, "correct")}>Correct</button>
                    <button className="secondary" disabled={!canWrite} onClick={() => recordAudit(item, "uncertain")}>Uncertain · queue challenge</button>
                    <button className="secondary danger" disabled={!canWrite} onClick={() => recordAudit(item, "incorrect", "occurrence")}>Incorrect occurrence · open correction</button>
                    <button className="secondary danger" disabled={!canWrite || stampDetail.status !== "approved"} onClick={() => recordAudit(item, "incorrect", "rule")}>Incorrect rule · suspend revision</button>
                  </div>
                </article>)}</div>
                {!stampAudit.items.length && <p className="wb-help">This revision has no active current applications to sample.</p>}
                <div className="wb-pagination"><button className="secondary" disabled={busy || stampAuditCursors.length === 1} onClick={() => {
                  const next = stampAuditCursors.slice(0, -1);
                  setStampAuditCursors(next);
                  void perform(() => loadStampAudit(next[next.length - 1]), false);
                }}>Previous audit page</button><button className="secondary" disabled={busy || !stampAudit.next_cursor} onClick={() => {
                  const next = [...stampAuditCursors, stampAudit.next_cursor];
                  setStampAuditCursors(next);
                  void perform(() => loadStampAudit(next[next.length - 1]), false);
                }}>Next audit page</button></div>
              </section>}
            </> : <div className="wb-empty"><h2>Select a stamp revision</h2><p>Create a literal proposal from a human-confirmed span, or generate a source-bound proposal in Model work.</p></div>}
          </section>
        </div>
      </>, "Approve one exact interpretation, then deterministic code reuses it.")}
      {view === "drafts" && panel("Assembly drafts", <>
        <div className="wb-registry-toolbar"><label>Status<select value={draftStatus} onChange={(event) => { setDraftStatus(event.target.value); setDraftCursors([null]); }}>
          <option value="">All states</option>{["proposed", "accepted", "blocked", "stale"].map((state) => <option key={state}>{state}</option>)}
        </select></label><p className="wb-help">{draftPage.total} current and historical drafts. Every page is capped at 20.</p></div>
        <div className="wb-registry-layout">
          <aside className="wb-registry-list" aria-label="Assembly drafts">{draftPage.items.map((item) => <button key={item.id} className={selectedDraftId === item.id ? "current" : ""} onClick={() => setSelectedDraftId(item.id)}>
            <span><strong>{item.ability_id}</strong><small>{item.faction_id} · {item.stamp_id}@{item.stamp_revision}</small></span>
            <span className={`wb-state wb-state-${item.status}`}>{item.status === "proposed" ? "Awaiting verification" : item.status}</span>
          </button>)}
          {!registryLoading && !draftPage.items.length && <p className="wb-help">No drafts match this state. Approved composition stamps create rule-derived drafts when complete source matches.</p>}
          <div className="wb-pagination"><button className="secondary" disabled={busy || draftCursors.length === 1} onClick={() => setDraftCursors((current) => current.slice(0, -1))}>Previous 20</button><button className="secondary" disabled={busy || !draftPage.next_cursor} onClick={() => setDraftCursors((current) => [...current, draftPage.next_cursor])}>Next 20</button></div></aside>
          <section className="wb-registry-detail">{draftDetail ? <>
            <header className="wb-detail-heading"><div><p className="eyebrow">Rule-derived · {draftDetail.faction_id}</p><h2>{draftDetail.ability_id}</h2><p className="wb-help"><code>{draftDetail.id}</code></p></div><span className={`wb-state wb-state-${draftDetail.status}`}>{draftDetail.status === "proposed" ? "Awaiting verification" : draftDetail.status}</span></header>
            {draftDetail.mechanics === null && <div className="wb-gap-callout"><strong>DSL gap</strong><p>The source-native graph is preserved, but this rule has no reviewed mechanics mapping.</p></div>}
            {draftDetail.status === "blocked" && <div className="wb-gap-callout"><strong>{String(draftDetail.diagnostic.reason_code ?? "Blocked")}</strong><p>{String(draftDetail.diagnostic.message ?? "This draft cannot be verified or published.")} Revise the composition stamp from its escalation in the Frontier; verification and publication stay unavailable.</p></div>}
            {draftDetail.publication && <div className="wb-publication"><strong>Accepted, not yet authored data</strong>
              <p className="wb-help">Publication is a guarded CLI step; the browser never writes tracked abilities.json.</p>
              <pre>{draftDetail.publication.prepare}{"\n"}{draftDetail.publication.publish}</pre>
              {draftDetail.publication.latest_batch && <p className="wb-help">Latest batch {draftDetail.publication.latest_batch.batch_id}: {draftDetail.publication.latest_batch.state}{draftDetail.publication.latest_batch.relative_path ? ` · ${draftDetail.publication.latest_batch.relative_path}` : ""}</p>}
            </div>}
            <div className="wb-comparison"><section><h3>Complete source</h3><blockquote>{draftDetail.source_text}</blockquote></section><section><h3>Generated English</h3><p>{draftDetail.rendered_text ?? "No schema-valid mechanics rendering is available."}</p></section></div>
            <div className="wb-actions"><button className="primary" disabled={busy || draftDetail.status !== "proposed"} onClick={() => {
              setView("work"); setWorkPurpose("verify-draft"); setWorkIds(draftDetail.id); void perform(() => prepareAndRunWork("verify-draft", [draftDetail.id]));
            }}>Run complete-source verification</button></div>
            <details open><summary>Source graph</summary><pre className="wb-artifact">{JSON.stringify(draftDetail.graph, null, 2)}</pre></details>
            <details><summary>Mechanics envelope</summary><pre className="wb-artifact">{JSON.stringify(draftDetail.mechanics, null, 2)}</pre></details>
            <details><summary>Dependencies and diagnostics</summary><pre className="wb-artifact">{JSON.stringify({ dependencies: draftDetail.dependencies, diagnostic: draftDetail.diagnostic, verifier_run_id: draftDetail.verifier_run_id }, null, 2)}</pre></details>
          </> : <div className="wb-empty"><h2>Select a draft</h2><p>Drafts remain rule-derived and await a complete-source verdict from Model work.</p></div>}</section>
        </div>
      </>, "Inspect source-native meaning beside generated mechanics.")}
      {view === "work" && panel("Model work", <>
        <section className="wb-work-step"><h2>1. Prepare bounded source evidence</h2><p>Prepare a source-bound packet, then run it with the server-side DeepSeek key or export it for an external assistant. Generated proposals never approve rules.</p>
          <div className="wb-editor-grid"><label>Purpose<select value={workPurpose} onChange={(event) => setWorkPurpose(event.target.value as WorkPurpose)}><option value="propose-rule">Propose rule</option><option value="challenge-rule">Challenge rule</option><option value="verify-draft">Verify draft</option></select></label>
            <label>Item limit<input type="number" min={1} max={15} value={workLimit} onChange={(event) => setWorkLimit(Number(event.target.value))} /></label></div>
          <label>Exact item IDs, comma separated<input value={workIds} onChange={(event) => setWorkIds(event.target.value)} placeholder="Leave blank for the deterministic frontier" /></label>
          <label>Retry reason<input value={workRetryReason} onChange={(event) => setWorkRetryReason(event.target.value)} placeholder="Required only to rerun unchanged evidence" /></label>
          <div className="wb-actions">
            <button className="primary" disabled={busy || !Number.isSafeInteger(workLimit) || workLimit < 1 || workLimit > 15} onClick={() => void perform(() => prepareAndRunWork(workPurpose, workIds.split(",").map((item) => item.trim()).filter(Boolean)))}>Prepare and run DeepSeek</button>
            <button className="secondary" disabled={busy || !Number.isSafeInteger(workLimit) || workLimit < 1 || workLimit > 15} onClick={() => void perform(async () => { await prepareModelWork(workPurpose, workIds.split(",").map((item) => item.trim()).filter(Boolean)); })}>Prepare packet only</button>
          </div>
          {preparedWork && <div className="wb-prepared-work"><dl className="wb-inline-facts"><div><dt>Run</dt><dd>{preparedWork.run_id}</dd></div><div><dt>Input hash</dt><dd><code>{preparedWork.input_hash}</code></dd></div><div><dt>Artifact</dt><dd><code>{preparedWork.request_path}</code></dd></div><div><dt>State</dt><dd>{preparedWork.reused ? `Reused ${preparedWork.status}` : preparedWork.status}</dd></div></dl>
            <button className="primary" disabled={busy || preparedWork.status !== "pending"} onClick={() => void perform(() => runPreparedWork(preparedWork))}>Run with DeepSeek</button>
            <button className="secondary" onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(preparedWork.request, null, 2)], { type: "application/json" }));
              const link = document.createElement("a"); link.href = url; link.download = `round5c-${workPurpose}-${preparedWork.run_id}.request.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
            }}>Download request JSON</button><details><summary>Inspect source-bound request</summary><pre className="wb-artifact">{JSON.stringify(preparedWork.request, null, 2)}</pre></details>
            {!!preparedWork.oversized.length && <details><summary>{preparedWork.oversized.length} oversized diagnostics</summary><pre>{JSON.stringify(preparedWork.oversized, null, 2)}</pre></details>}
          </div>}
        </section>
        <section className="wb-work-step"><h2>2. Review the imported proposal</h2><p>DeepSeek runs import automatically. Manual responses still use the controls below. Every item is rechecked against source and decision evidence; rules remain unapproved.</p>
          <label>Run identifier<input value={workRunId} onChange={(event) => setWorkRunId(event.target.value)} /></label>
          <label>Response JSON file<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setWorkResponse).catch(fail); event.target.value = ""; }} /></label>
          <label>Complete response JSON<textarea rows={14} value={workResponse} onChange={(event) => setWorkResponse(event.target.value)} spellCheck={false} /></label>
          <button className="primary" disabled={busy || !workRunId.trim() || !workResponse.trim()} onClick={() => void perform(async () => {
            const response: unknown = JSON.parse(workResponse);
            const result = await api<WorkImportReport>("/work/import", { run_id: workRunId.trim(), response });
            setWorkReport(result);
            setStatus(`Work import finished: ${result.imported} imported, ${result.stale} stale, ${result.failed} failed.`);
          })}>Validate and import response</button>
          {workReport && <div className="wb-import-report"><h3>Import result</h3><p>{workReport.imported} imported · {workReport.stale} stale · {workReport.failed} failed</p>{workReport.items.map((item) => <div key={item.item_id}><strong>{item.item_id}</strong><span className={`wb-state wb-state-${item.status}`}>{item.status}</span><p>{item.reason}</p></div>)}</div>}
        </section>
      </>, "The server holds the DeepSeek key; requests and responses still use the source-bound work protocol.")}
      {view === "queue" && panel("Next up", <>
        {queue ? <>
          <p className="wb-help">{queue.total} review targets{faction ? ` in ${faction}` : ""}. Conflicts and complete-source composition come first, then repeatable leaf decisions. Other source contexts need separate inspection; approved stamps apply corpus-wide.</p>
          <ol className="wb-work-queue">{queue.items.map((item, index) => <li key={item.key} className={`wb-frontier-row wb-queue-${item.kind}`}>
            <header><span className="wb-state">{QUEUE_KIND_LABELS[item.kind] ?? item.kind}</span>{item.kind !== "luna" && item.kind !== "conflict" && item.kind !== "broad-seed" && item.kind !== "unparsed-source" && item.kind !== "whole-context-check" && <strong>{item.kind === "family-group" ? `${item.unlocks} in one context · ${item.backlog} total` : item.kind === "ability" ? `${item.backlog} proposals · one at a time` : item.kind === "composition" ? `${item.unlocks} reviewed source` : item.kind === "stamp" && item.backlog === 0 ? "Needs revision" : `${item.unlocks} eligible matches`}</strong>}{index === 0 && <small>start here</small>}</header>
            <p>{item.why}</p>
            <button className={index === 0 ? "primary" : "secondary"} disabled={busy} onClick={() => openQueueItem(item)}>{item.kind === "composition" ? "Generate composition proposal" : item.kind === "luna" ? "Prepare Luna residue request" : item.kind === "stamp" ? "Preview stamp" : item.kind === "family-group" ? "Review group" : item.kind === "unparsed-source" ? "Open and analyze source" : item.kind === "whole-context-check" ? "Open the composition queue" : "Open ability"}</button>
          </li>)}</ol>
          {!queue.items.length && <div className="wb-empty"><h2>Nothing queued</h2><p>No pending proposals, stamps, or residue remain{faction ? " for this faction" : ""}.</p></div>}
        </> : <p role="status">{loading ? "Ranking the next decisions…" : "Queue unavailable. Reload to retry."}</p>}
      </>, "Compose reviewed sources and prioritize actionable leaf decisions. Faction narrows every item.")}
      {view === "frontier" && panel("Review frontier", <>
        <section className="wb-frontier-section wb-escalations"><div className="wb-section-row"><div><h2>Escalations</h2><p className="wb-help">{escalationPage.total} {escalationStatus} groups. Deferral preserves unresolved coverage.</p></div><div className="wb-queue-filter" role="group" aria-label="Escalation state"><button className="secondary" aria-pressed={escalationStatus === "open"} onClick={() => { setEscalationStatus("open"); setEscalationCursors([null]); }}>Open</button><button className="secondary" aria-pressed={escalationStatus === "deferred"} onClick={() => { setEscalationStatus("deferred"); setEscalationCursors([null]); }}>Deferred</button></div></div>
          {escalationPage.items.map((item) => {
            const proposedOption = Array.isArray(item.options)
              ? item.options.slice().reverse().find((option) => typeof option === "object" && option !== null
                && "stamp_id" in option && typeof option.stamp_id === "string"
                && "revision" in option && typeof option.revision === "number") as Record<string, unknown> | undefined
              : undefined;
            const stampId = typeof item.question.stamp_id === "string"
              ? item.question.stamp_id
              : typeof proposedOption?.stamp_id === "string" ? proposedOption.stamp_id : null;
            const stampRevision = typeof item.question.revision === "number"
              ? item.question.revision
              : typeof item.question.stamp_revision === "number"
                ? item.question.stamp_revision
                : typeof proposedOption?.revision === "number" ? proposedOption.revision : null;
            return <article className="wb-escalation" key={item.id}><header><div><span className="wb-state wb-state-blocked">{item.reason_code}</span><h3>{item.id}</h3></div><span>{item.occurrence_count} occurrence{item.occurrence_count === 1 ? "" : "s"}</span></header>
              <p>{typeof item.question.question === "string" ? item.question.question : "Review the preserved source-bound evidence and choose the next explicit action."}</p>
              {item.sources.map((source) => <div key={source.ability_version_id} className="wb-escalation-source">
                <p><strong>{source.name ?? source.ability_id}</strong> <small>{source.faction_id}/{source.ability_id}</small>
                  <button className="text-button" onClick={() => openAbility(source.ability_version_id)}>Open ability</button></p>
                {source.span_text && <p className="wb-help">Span: “{source.span_text}”</p>}
                <blockquote>{source.source_text}</blockquote>
              </div>)}
              {item.occurrence_count > item.sources.length && <p className="wb-help">Showing {item.sources.length} of {item.occurrence_count} sources.</p>}
              {item.reason_code === "COMPOSITION_GAP" && <p className="wb-help"><strong>Next:</strong> {stampId && stampRevision
                ? "a rule was proposed. Inspect it, run its independent challenge, then approve it; approval creates the draft and closes this gap."
                : "no rule yet. Generate an assistant proposal, or fire it with others from Ready for composition."}</p>}
              <details><summary>Question, options, and impact</summary><pre>{JSON.stringify({ question: item.question, options: item.options, assemblable_abilities: item.assemblable_abilities }, null, 2)}</pre></details>
              <label>Revision note<textarea rows={2} value={escalationNotes[item.id] ?? ""} onChange={(event) => setEscalationNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Explain the semantic change needed" /></label>
              <div className="wb-actions">
                {stampId && stampRevision && <button className="secondary" onClick={() => { setView("stamps"); chooseStamp({ id: stampId, revision: stampRevision }); }}>Inspect proposed rule</button>}
                <button className="secondary" disabled={busy} onClick={() => { setView("work"); setWorkPurpose("propose-rule"); setWorkIds(item.id); void perform(() => prepareAndRunWork("propose-rule", [item.id])); }}>Generate assistant proposal</button>
                {item.state === "open" ? <button className="secondary" disabled={!canWrite} onClick={() => decideEscalationItem(item, "defer")}>Defer</button> : <button className="secondary" disabled={!canWrite} onClick={() => decideEscalationItem(item, "reopen")}>Reopen</button>}
                <button className="secondary" disabled={!canWrite || !escalationNotes[item.id]?.trim()} onClick={() => decideEscalationItem(item, "request-revision")}>Request revision</button>
              </div>
            </article>;
          })}
          {!registryLoading && !escalationPage.items.length && <p className="wb-help">No {escalationStatus} escalation groups.</p>}
          <div className="wb-pagination"><button className="secondary" disabled={busy || escalationCursors.length === 1} onClick={() => setEscalationCursors((current) => current.slice(0, -1))}>Previous 20</button><button className="secondary" disabled={busy || !escalationPage.next_cursor} onClick={() => setEscalationCursors((current) => [...current, escalationPage.next_cursor])}>Next 20</button></div>
        </section>
        {frontier ? <>
          <section className="wb-frontier-section"><h2>Repeated unresolved surfaces</h2>{frontier.clusters.length ? frontier.clusters.map((cluster) => <div className="wb-frontier-row" key={cluster.signature}><h3>{cluster.signature}</h3><p>{cluster.count} occurrences</p>{cluster.samples.map((sample, index) => <button className="wb-region" disabled={busy} key={`${sample.ability_version_id}:${index}`} onClick={() => openAbility(sample.ability_version_id)}><span>{sample.exact_text}</span><small>{sample.fragment} · {sample.start_byte}–{sample.end_byte} · inspect complete ability</small></button>)}</div>) : <p className="wb-help">No repeated unresolved clusters in the current frontier.</p>}</section>
          <section className="wb-frontier-section"><h2>Conflicting proposals</h2>{frontier.conflicts.length ? frontier.conflicts.map((conflict) => <div className="wb-frontier-row" key={conflict.proposal_id}><p>{readable(conflict.reason)}</p><button className="secondary" disabled={busy} onClick={() => openAbility(conflict.ability_version_id, conflict.proposal_id)}>Inspect proposal {conflict.proposal_id}</button></div>) : <p className="wb-help">No conflicting proposals reported.</p>}</section>
          <section className="wb-frontier-section"><h2>Low-coverage abilities</h2>{frontier.abilities.slice(0, 15).map((item) => <button className="wb-frontier-ability" key={item.id} disabled={busy} onClick={() => openAbility(item.id)}><span>{item.faction_id} / {item.ability_id}</span><span>{percent(item.leaf_fraction)} confirmed leaf</span></button>)}{!frontier.abilities.length && <p className="wb-help">No abilities awaiting direct review in this frontier.</p>}</section>
        </> : <p role="status">{loading ? "Loading unresolved frontier…" : "Frontier unavailable. Reload to retry."}</p>}
      </>, "Exceptions first, then repeated gaps, conflicts, and low-coverage source.")}
      {view === "dashboard" && panel("Coverage census", <><div className="wb-actions"><button className="secondary" disabled={busy} onClick={refreshSourceStore}>Refresh sources from the store</button></div><p className="wb-help">Current source versions only. Confirmed leaf coverage and machine proposals are separate; whole-reviewed coverage is an independent safety gate. Missing denominators remain unknown.</p>{dashboard ? <MetricValue value={dashboard} /> : <p role="status">{loading ? "Loading recorded coverage…" : "Coverage unavailable. Reload to retry."}</p>}</>)}
      {view === "luna" && panel("Luna batches", <>
        <section className="wb-luna-section"><h2>1. Export complete source</h2><p>This legacy Luna batch path stays external. Model work runs source-bound proposals through server-side DeepSeek; this path does not send a request to the provider.</p>
          <div className="wb-actions"><label>Complete abilities<input type="number" min={10} max={15} value={lunaLimit} onChange={(event) => setLunaLimit(Number(event.target.value))} /></label>
            <label>Source sent<select value={lunaMode} onChange={(event) => setLunaMode(event.target.value as LunaMode)}><option value="residue">Residue: unclaimed source only</option><option value="coverage">Coverage: every uncovered region</option></select></label>
            <button className="primary" disabled={busy || !Number.isInteger(lunaLimit) || lunaLimit < 10 || lunaLimit > 15} onClick={() => void perform(async () => {
            const result = await api<PreparedRun>("/luna/prepare", { limit: lunaLimit, mode: lunaMode, ...(faction ? { faction_id: faction } : {}) }); setRun(result); setRunId(result.run_id); setStatus("Complete request prepared. Run it externally, then import the matching response.");
          })}>Prepare request</button></div>
          {run && <><dl className="wb-run-details"><dt>Run</dt><dd>{run.run_id}</dd><dt>Input hash</dt><dd><code>{run.input_hash}</code></dd></dl><button className="secondary" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(run.request, null, 2)], { type: "application/json" }));
            const link = document.createElement("a"); link.href = url; link.download = `round5c-luna-request.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
          }}>Download request JSON</button><details><summary>Inspect complete request artifact</summary><pre className="wb-artifact">{JSON.stringify(run.request, null, 2)}</pre></details></>}
        </section>
        <section className="wb-luna-section"><h2>2. Import the matching response</h2><p>The server validates identities, hashes, byte boundaries, every supplied family, and batch completeness. Accepted model output is pending, never human-confirmed.</p><label>Run identifier<input value={runId} onChange={(event) => setRunId(event.target.value)} autoComplete="off" /></label>
          <label>Response JSON file<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setLunaResponse).catch(fail); event.target.value = ""; }} /></label>
          <label>Response JSON<textarea value={lunaResponse} onChange={(event) => setLunaResponse(event.target.value)} rows={12} spellCheck={false} placeholder="Paste the complete response object from the external run" /></label>
          <button className="primary" disabled={busy || !runId.trim() || !lunaResponse.trim()} onClick={() => void perform(async () => {
            const response = parameters(lunaResponse);
            const result = await api<{ run_id: string; proposals: number; unresolved: number; structural: number }>("/luna/import", { run_id: runId.trim(), response });
            setStatus(`Imported ${result.proposals} pending proposals, ${result.structural} structural suggestions, and ${result.unresolved} unresolved regions as unverified external work. Review them in Ability mode.`); setLunaResponse(""); setRevision((value) => value + 1);
          })}>Validate and import pending proposals</button>
        </section>
      </>, "Complete batches in, reviewable proposals out.")}
    </main>
  </div>;
}
