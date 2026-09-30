import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { utf8Selection } from "./model";
import { alphabetical, api, readable } from "./workbench-api";
import { SourceWorkPanel, type SourceWorkAbility } from "./SourceWorkPanel";
import { LeavesPage } from "./LeavesPage";
import { ProposalsPage } from "./ProposalsPage";
import { ShapesPage } from "./ShapesPage";
import { PublishPage } from "./PublishPage";
import { QueueStrip } from "./QueueStrip";
import { useDecisionQueue } from "./decision-queue";
import type { Family } from "./LeafForm";
import "./workbench.css";

type Role = "EFFECT" | "DURATION" | "EVENT" | "CONDITION" | "RESTRICTION" | "COMBINATOR";
type View = "leaves" | "proposals" | "shapes" | "publish" | "abilities" | "dashboard";
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
  authority_kind: "human" | "derived" | "machine";
  rule_authorized_by: string | null;
};
type Proposal = Span & { reason: unknown; score: number | null; status: string };
type Ability = {
  id: number; current: boolean; faction_id: string; ability_id: string; source_hash: string; review_evidence_hash: string; pilot_reviewed: boolean; source_text: string;
  source_type: string | null; source_kind: string | null; name: string | null;
  fragments: Fragment[]; annotations: Annotation[]; proposals: Proposal[];
  coverage: SourceWorkAbility["coverage"] & { proposal_fraction: number; whole_reviewed: boolean; uncovered: Fragment[]; unaccounted: Fragment[]; residue: Fragment[] };
  progress: LeafProgress;
  atoms: SourceWorkAbility["atoms"];
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
type UncoveredSelection = Fragment & { ability_version_id: number; source_hash: string; ability_id: string; faction_id: string };
type ParameterProperty = { enum?: string[]; anyOf?: Array<{ enum?: string[]; type?: string; const?: string }>; type?: string; items?: { enum?: string[] } };
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

const ROLES: Role[] = ["EFFECT", "DURATION", "EVENT", "CONDITION", "RESTRICTION", "COMBINATOR"];
const ROLE_LABELS: Record<Role, string> = {
  EFFECT: "Effect: what changes", DURATION: "Duration: how long",
  EVENT: "Event: when it fires", CONDITION: "Condition: when it applies",
  RESTRICTION: "Restriction: who, how often, or when it can be used", COMBINATOR: "Combinator: how effects combine (instead)",
};
const CHARACTERISTICS = ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"];
const REVIEWER = "local-reviewer";
/** `?abilities=1,2,3` limits the Sources list to those source versions (one pilot step's cohort). */
const ONLY_ABILITIES = new URLSearchParams(window.location.search).get("abilities")?.replace(/[^0-9,]/g, "") || null;
const VIEWS: { id: View; label: string }[] = [
  { id: "leaves", label: "Leaves" },
  { id: "proposals", label: "AI leaf proposals" },
  { id: "shapes", label: "Shapes" },
  { id: "publish", label: "Publish" },
  { id: "abilities", label: "Sources" },
  { id: "dashboard", label: "Coverage" },
];
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
          className={`wb-paint wb-role-${role} wb-${paint.kind}${paint.kind === "annotation" && paint.span.authority_kind === "machine" ? " wb-machine" : ""}${selected ? " wb-selected" : ""}`}
          title={`${paint.kind === "annotation" ? paint.span.authority_kind === "machine" ? "Machine label, not reviewed" : paint.span.authority_kind === "derived" ? "Confirmed (applied from a decided wording)" : "Confirmed" : "Unconfirmed proposal"}: ${paint.span.role}, ${paint.span.family_id ?? "unresolved"}. Bytes ${segment.start}–${segment.end}${segment.paints.length > 1 ? ". Multiple overlapping spans; use the inspector list." : ""}`}
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
      ? "Separate from span approval. Source or span changes invalidate this check."
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

/** Known leaves, reviewed connectives, and what is still open: the gate for upward composition. */
function LeafProgressStrip({ progress }: { progress: LeafProgress }) {
  const open = progress.pending_proposals + progress.unresolved_proposals + progress.open_leaf_gaps;
  return <div className="wb-leaf-progress" aria-label="Leaf progress">
    {progress.leaves.length ? progress.leaves.map((leaf) => <span key={`${leaf.family_id}:${leaf.authority_kind}`} className="wb-leaf-chip">{leaf.family_id} ×{leaf.count}</span>) : <span className="wb-help">No confirmed leaves</span>}
    {progress.connective_bytes > 0 && <span>{progress.connective_bytes} connective bytes reviewed</span>}
    {open > 0 && <span>{progress.pending_proposals} pending · {progress.unresolved_proposals} unresolved · {progress.open_leaf_gaps} leaf gaps</span>}
    {progress.residue_regions > 0 && <span>{progress.residue_regions} unclaimed region{progress.residue_regions === 1 ? "" : "s"} ({progress.residue_bytes} bytes)</span>}
    <span className={progress.composition_ready ? "wb-reviewed" : ""}>{progress.composition_ready ? "Ready for composition" : "Not composition-ready"}</span>
  </div>;
}

export default function WorkbenchApp() {
  const [view, setView] = useState<View>("leaves");
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
  const [families, setFamilies] = useState<ReviewedFamily[]>([]);
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const knownWorkbenchRevision = useRef<number | null>(null);
  const revisionRequestInFlight = useRef(false);
  const localRevisionExpected = useRef(false);
  const activeRevisionMutation = useRef(false);
  const dirtyState = useRef(false);
  const dirtyAbilityId = useRef<number | null>(null);
  const inspector = useRef<HTMLElement>(null);
  const visible = focused ? [focused] : page.items;
  const ability = focused ?? page.items.find((item) => item.id === activeId) ?? null;
  const cursor = cursors[cursors.length - 1];
  const safeProposals = ability?.proposals.filter((proposal) => proposal.status === "pending" && proposal.family_id && ROLES.includes(proposal.role as Role)
    && !ability.annotations.some((span) => overlaps(span, proposal))
    && !ability.proposals.some((other) => pending(other) && other.id !== proposal.id && overlaps(proposal, other))) ?? [];
  const { queue, items: queueItems } = useDecisionQueue({
    onBatch: (batchId) => setBatches((current) => [...current, batchId]),
    // One refresh for the whole run of decisions, not one per decision.
    onDrained: () => { void syncWorkbenchRevision(true); setRevision((value) => value + 1); },
  });
  const queueActive = queueItems.some((item) => item.status !== "failed");
  const queueActiveRef = useRef(false);
  queueActiveRef.current = queueActive;
  const canWrite = !busy && !loading;
  const canUndo = canWrite && !queueActive && batches.length > 0;
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
    api<AbilityPage>(`/abilities?limit=12&reviewState=${reviewState}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${search ? `&query=${encodeURIComponent(search)}` : ""}${faction ? `&faction=${encodeURIComponent(faction)}` : ""}${ONLY_ABILITIES ? `&abilities=${ONLY_ABILITIES}` : ""}`, undefined, controller.signal)
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
    if (view !== "dashboard") {
      setViewLoading(false);
      return;
    }
    const controller = new AbortController();
    setViewLoading(true); setError(null);
    if (view === "dashboard") setDashboard(null);
    api<unknown>("/dashboard", undefined, controller.signal).then((result) => {
      setDashboard(result as Record<string, unknown>);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setViewLoading(false); });
    return () => controller.abort();
  }, [view, faction, revision]);

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
      const isLocalChange = localChange || activeRevisionMutation.current || localRevisionExpected.current || queueActiveRef.current;
      localRevisionExpected.current = false;
      setRevision((value) => value + 1);
      if (isLocalChange) return;

      const warning = dirtyState.current
        ? "Workbench changed; review updated evidence"
        : "Workbench changed in another session. Current lists were refreshed.";
      setExternalNotice(warning);
      setStatus(warning);
    } finally {
      revisionRequestInFlight.current = false;
    }
  }
  function refreshSourceStore() {
    void perform(async () => {
      const result = await api<{ inserted: number; retained: number; reactivated: number; retired: number }>("/sources/refresh", {});
      setStatus(`Source refresh: ${result.inserted} new, ${result.reactivated} reactivated, ${result.retired} retired, ${result.retained} unchanged source versions.`);
    });
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
  /** Confirm the selected wording and meaning as a corpus-wide leaf surface. */
  function decideEverywhere() {
    if (!ability || !draft) return;
    void perform(async () => {
      const exactText = sourceSlice(ability, draft.fragment, Number(draft.start), Number(draft.end));
      const result = await api<{ batch_id: string; applied: number; already: number; blocked: unknown[] }>("/leaves/confirm", {
        reviewer: REVIEWER, exact_text: exactText, family_id: draft.family.trim(), family_version: Number(draft.version), parameters: parameters(draft.parameters),
      });
      setBatches((current) => [...current, result.batch_id]); setDraft(null);
      setStatus(`Decided everywhere: ${result.applied} occurrence${result.applied === 1 ? "" : "s"} annotated, ${result.already} already had it, ${result.blocked.length} left alone. Undo reverses it.`);
      await refreshAbilities([ability.id]);
    });
  }
  function undo() {
    const batch = batches[batches.length - 1];
    if (!batch || queue.active) return;
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
  function openAbility(id: number, proposalId?: number) {
    void perform(async () => {
      const item = await api<Ability>(`/abilities/${id}`);
      setFocused(item); setActiveId(item.id); setView("abilities");
      const proposal = item.proposals.find((entry) => entry.id === proposalId);
      setDraft(proposal ? spanDraft(item, proposal, "proposal") : null);
      setStatus("Inspecting the complete source. Return to the page or Leaves when finished.");
    }, false);
  }

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable], [role='textbox']")) return;
      const key = event.key.toLowerCase();
      if (key === "?") { event.preventDefault(); setShortcuts((value) => !value); return; }
      if (busy || loading) return;
      if (key === "u" && canUndo) { event.preventDefault(); undo(); }
      else if (key === "l") { event.preventDefault(); setView("leaves"); }
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
  const editorDirty = Boolean(
    reselecting
    || draft?.kind === "selection"
    || draftChanged
    || dirtyCensusAbilityId !== null,
  );

  useEffect(() => {
    dirtyState.current = editorDirty;
    dirtyAbilityId.current = dirtyCensusAbilityId ?? (reselecting || draft?.kind === "selection" || draftChanged ? draft?.ability_id ?? null : null);
  }, [editorDirty, dirtyCensusAbilityId, reselecting, draft, draftChanged]);

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
    </header>
    <aside className="wb-sidebar" aria-label="Ability page">
      <label htmlFor="wb-faction">Faction</label>
      <select id="wb-faction" value={faction} disabled={view === "abilities" && editorDirty} onChange={(event) => {
        setFaction(event.target.value); setCursors([null]); setFocused(null); setDraft(null);
      }}><option value="">All factions</option>{alphabetical(factions).map((id) => <option key={id} value={id}>{id}</option>)}</select>
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
        <button className="secondary" disabled={!canUndo} title={queueActive ? "Waits for queued decisions to finish" : undefined} onClick={undo}>Undo batch <kbd>U</kbd></button></div>
    </aside>
    <main id="wb-main" className={`wb-main${view === "abilities" ? " wb-main-abilities" : ""}`} aria-busy={loading || busy}>
      <div className="wb-feedback">
        {error
          ? <p role="alert" className="error">{error}</p>
          : externalNotice
            ? <p role="status" className="warning">{externalNotice}</p>
            : <p role="status">{busy ? "Recording decision…" : loading ? "Loading workbench records…" : status}</p>}
        <QueueStrip items={queueItems} queue={queue} />
        <button className="text-button" disabled={busy} onClick={() => {
          setDraft(null);
          setCensusResetToken((value) => value + 1);
          setExternalNotice(null);
          setRevision((value) => value + 1);
          if (focused) void perform(async () => { await refreshAbilities([focused.id]); }, false);
        }}>Reload</button>
      </div>
      {shortcuts && <aside className="wb-shortcuts" aria-label="Keyboard shortcuts"><span><kbd>A</kbd> approve / correct</span><span><kbd>R</kbd> reject</span><span><kbd>N</kbd> novel</span><span><kbd>B</kbd> ambiguous</span><span><kbd>J</kbd>/<kbd>K</kbd> next / previous ability</span><span><kbd>L</kbd> Leaves</span><span><kbd>U</kbd> undo batch</span><span>Shortcuts pause in form fields.</span></aside>}
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
              setStatus={setStatus} />
            <div className="wb-span-list"><h3>Source spans</h3>{[...ability.annotations.map((span) => ({ span, kind: "annotation" as const })), ...ability.proposals.filter(pending).map((span) => ({ span, kind: "proposal" as const }))].map(({ span, kind }) => <button key={`${kind}-${span.id}`} className={`wb-span-row${draft?.span?.id === span.id && draft.kind === kind ? " current" : ""}`} onClick={() => inspect(ability, span, kind)}>
              <span>{span.exact_text}</span><small>{kind === "annotation" ? span.authority_kind === "machine" ? "Machine" : span.authority_kind === "derived" ? "Applied" : "Confirmed" : "Proposal"} · {span.role} · {span.start_byte}–{span.end_byte}</small></button>)}
              {!ability.annotations.length && !ability.proposals.filter(pending).length && <p className="wb-help">Select a source phrase to create a grounded annotation or flag a leaf gap.</p>}
            </div>
            {draft && draft.ability_id === ability.id && <section className="wb-editor" aria-labelledby="wb-edit-title"><h3 id="wb-edit-title">{draft.kind === "annotation" ? (draft.span as Annotation).authority_kind === "machine" ? "Review machine label" : "Correct confirmed span" : draft.kind === "proposal" ? "Review proposal" : "Paint selected source"}</h3>
              {boundaryError ? <p className="error" role="alert">{boundaryError}</p> : <blockquote>{selectedText}</blockquote>}
              <div className="wb-editor-grid"><label>Fragment<select value={draft.fragment} onChange={(event) => editDraft({ fragment: event.target.value })}>{ability.fragments.map((fragment) => <option key={fragment.fragment}>{fragment.fragment}</option>)}</select></label>
                {connectiveProposal
                  ? <label>Role<input value="CONNECTIVE" readOnly /></label>
                  : <label>Role<select value={draft.role} onChange={(event) => {
                    const role = event.target.value;
                    editDraft(families.some((item) => item.id === draft.family && item.role === role)
                      ? { role } : { role, family: "", version: "1", parameters: "{}" });
                  }}>{[...alphabetical(ROLES, (role) => ROLE_LABELS[role]), "UNRESOLVED"].map((role) => <option key={role} value={role}>{role === "UNRESOLVED" ? "Unresolved: record a gap" : ROLE_LABELS[role as Role]}</option>)}</select></label>}</div>
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
                {alphabetical(families.filter((item) => item.role === draft.role), (item) => item.label).map((item) => <option key={`${item.id}@${item.version}`} value={item.id}>{item.label}</option>)}
              </select></label>
                {selectedFamily && <p className="wb-help">{selectedFamily.description} <code>{selectedFamily.id}@{selectedFamily.version}</code></p>}
                {draft.role === "CONDITION" && <p className="wb-help">Mark the condition separately from its effect. A reviewed condition family must express the entire condition, including named-model qualifiers; otherwise record Novel or Ambiguous.</p>}
                {draft.family === "critical-hit-threshold" && <p className="wb-help">Critical hits are not the same as hits scored. If this text only changes which unmodified Hit rolls score hits, do not confirm it as a critical-hit threshold.</p>}
                {draft.family === "characteristic-set" && <><div className="wb-editor-grid">
                  <label>Subject<select value={String(draftParameters?.subject ?? "")} onChange={(event) => editParameter("subject", event.target.value)}><option value="bearer">Bearer</option><option value="this-model">This model</option><option value="this-unit">This unit</option></select></label>
                  <label>Characteristic<select value={String(draftParameters?.characteristic ?? "")} onChange={(event) => editParameter("characteristic", event.target.value)}><option value="">Choose a characteristic</option>{alphabetical(CHARACTERISTICS).map((stat) => <option key={stat} value={stat}>{stat}</option>)}</select></label>
                  <label>Set to<input type="number" step={1} value={typeof draftParameters?.value === "number" ? draftParameters.value : ""} onChange={(event) => editParameter("value", event.target.value === "" ? null : Number(event.target.value))} placeholder="Numeric value from source" /></label>
                </div><p className="wb-help">Sets the named characteristic; it does not add to a roll. Select the exact source region, including the bearer or other subject. The Save value 3 represents 3+ in the source. Source-qualified values can be entered in JSON.</p></>}
                {draft.family === "weapon-ability-grant" && <><div className="wb-editor-grid">
                  <label>Whose weapons?<select value={String(draftParameters?.subject ?? "")} onChange={(event) => editParameter("subject", event.target.value)}>
                    <option value="bearer">Bearer</option><option value="this-unit">Models in this unit</option><option value="this-model">This model</option>
                  </select></label>
                  <label>Weapon ability<select value={String(draftParameters?.keyword ?? "")} onChange={(event) => editParameter("keyword", event.target.value)}>
                    <option value="">Choose the ability named in the source</option>
                    {alphabetical(selectedFamily?.parameterSchema.properties?.keyword?.enum ?? []).map((keyword) => <option key={keyword} value={keyword}>{keyword}</option>)}
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
                    // A list of closed values (for example several characteristics changed together): pick each one.
                    if (property.type === "array" && property.items?.enum) {
                      const selected = Array.isArray(value) ? value.map(String) : [];
                      return <fieldset key={name} className="wb-field-wide"><legend>{name.replaceAll("-", " ")} (every one that applies)</legend>
                        <div className="wb-chips" role="group" aria-label={name}>{alphabetical(property.items.enum, (option) => option.replaceAll("-", " ")).map((option) => {
                          const on = selected.includes(option);
                          return <button key={option} type="button" role="checkbox" aria-checked={on} className={on ? "wb-chip wb-chip-on" : "wb-chip"}
                            onClick={() => editParameter(name, on ? selected.filter((item) => item !== option) : [...selected, option])}>{option.replaceAll("-", " ")}</button>;
                        })}</div></fieldset>;
                    }
                    if (property.type === "boolean") {
                      return <label key={name}>{name.replaceAll("-", " ")}<select value={value === true ? "yes" : value === false ? "no" : ""} onChange={(event) => editParameter(name, event.target.value === "" ? null : event.target.value === "yes")}>
                        <option value="">Choose {name.replaceAll("-", " ")}</option><option value="no">no</option><option value="yes">yes</option></select></label>;
                    }
                    return <label key={name}>{name.replaceAll("-", " ")}
                      {choices.length ? <select value={typeof value === "string" ? value : ""} onChange={(event) => editParameter(name, event.target.value)}>
                        <option value="">Choose {name.replaceAll("-", " ")}</option>{alphabetical(choices, (choice) => choice.replaceAll("-", " ")).map((choice) => <option key={choice} value={choice}>{choice.replaceAll("-", " ")}</option>)}
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
                {draft.kind === "annotation" && <><dt>{(draft.span as Annotation).authority_kind === "machine" ? "Labelled by (machine)" : "Confirmed by"}</dt><dd>{(draft.span as Annotation).rule_authorized_by ?? (draft.span as Annotation).confirmed_by}</dd></>}
                {draft.kind === "proposal" && <><dt>Status</dt><dd>{(draft.span as Proposal).status}</dd><dt>Score</dt><dd>{(draft.span as Proposal).score ?? "Unknown"}</dd><dt>Reason</dt><dd><pre>{readable((draft.span as Proposal).reason)}</pre></dd></>}
              </dl></details>}
              <div className="wb-decision-actions">{connectiveProposal ? <>{pendingConnectiveProposal && <button className="primary" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("confirm-connective")}>Confirm connective <kbd>A</kbd></button>}
                <button className="secondary danger" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("reject")}>Reject <kbd>R</kbd></button></> : <><button className="primary" disabled={!canWrite || reselecting || !!boundaryError || !supportsSemanticConfirmation} onClick={() => decide(approveAction)}>{approveAction === "correct" ? "Apply correction" : "Confirm leaf"} <kbd>A</kbd></button>
                {draft.kind === "proposal" && <button className="secondary danger" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("reject")}>Reject <kbd>R</kbd></button>}
                {draft.kind !== "annotation" && <><button className="secondary" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("novel")}>Novel <kbd>N</kbd></button><button className="secondary" disabled={!canWrite || reselecting || !!boundaryError || !!draftChanged} onClick={() => decide("ambiguous")}>Ambiguous <kbd>B</kbd></button></>}</>}</div>
              <p className="wb-help">{connectiveProposal ? pendingConnectiveProposal ? "Connectives are reviewed source relations, not semantic fingerprints. Confirm or reject this pending connective without changing its source bytes." : "This connective is no longer pending and can only be rejected if it remains reviewable." : draft.kind === "annotation" ? "Accepted spans allow corrections. A correction supersedes this exact interpretation; use batch undo to retract a recent human confirmation." : draftChanged ? "Edited proposals must be applied as corrections. Reopen the original span to reject or flag it instead." : "Unresolved proposals can be rejected, assigned a reviewed family, or recorded as novel or ambiguous leaf gaps."}</p>
              {!connectiveProposal && draft.kind !== "annotation" && <button className="primary" disabled={!canWrite || reselecting || !!boundaryError || !supportsSemanticConfirmation} onClick={decideEverywhere}>Confirm everywhere this wording appears</button>}
            </section>}
            <section className="wb-bulk"><button className="secondary" disabled={!canWrite || !safeProposals.length} onClick={() => void perform(() => apply(safeProposals.map((proposal) => proposalDecision(ability, proposal, "confirm"))))}>Confirm {safeProposals.length} nonconflicting proposals</button><p className="wb-help">Only this inspected ability. Overlapping proposals and unregistered regions are excluded. This does not check whole context.</p></section>
            {ONLY_ABILITIES && <section className="wb-census" aria-label="Pilot step review">
              <h3>Pilot step review</h3>
              {ability.pilot_reviewed
                ? <p className="wb-reviewed">Marked reviewed for this pilot step.</p>
                : <><button className="primary" disabled={!canWrite} onClick={() => void perform(async () => {
                    await api<Ability>(`/abilities/${ability.id}/pilot-reviewed`, { source_hash: ability.source_hash, reviewer: REVIEWER });
                    setRevision((value) => value + 1);
                    setStatus("Marked reviewed for this pilot step.");
                  })}>Done reviewing this ability</button>
                  <p className="wb-help">When every label here is confirmed, corrected or rejected. Wording no family fits can stay unresolved. The next pilot step waits for all of this step's abilities.</p></>}
            </section>}
            <ReviewCensus key={`${ability.id}:${censusResetToken}`} ability={ability} disabled={!canWrite} onDirtyChange={setDirtyCensusAbilityId} save={(checked, shape, cues, expectedReviewHash) => void perform(async () => {
              const updated = await api<Ability>(`/abilities/${ability.id}/review`, { source_hash: ability.source_hash, expected_review_hash: expectedReviewHash, reviewer: REVIEWER, whole_context_checked: checked, ...(shape.trim() ? { source_shape: shape.trim() } : {}), cues: parameters(cues) });
              setDirtyCensusAbilityId(null); setDraft(null); setRevision((value) => value + 1);
              setStatus(checked ? "Whole-context check recorded." : "Whole-context check cleared. This ability moved to To review.");
              setFocused(null);
              setPage((current) => ({ ...current, items: current.items.filter((item) => item.id !== updated.id) }));
            })} />
          </> : <p className="wb-help">Choose an ability to inspect source provenance, span decisions, and whole-context review.</p>}
        </aside></div>
      </>}
      {view === "leaves" && panel("Leaves", <LeavesPage families={families as unknown as Family[]} faction={faction} revision={revision}
        queue={queue} queueItems={queueItems} reviewer={REVIEWER} openAbility={openAbility} setStatus={setStatus} />, "Decide each spelling once; it applies to every source.")}
      {view === "proposals" && panel("AI leaf proposals", <ProposalsPage families={families as unknown as Family[]} faction={faction} revision={revision}
        queue={queue} queueItems={queueItems} reviewer={REVIEWER} setStatus={setStatus} openAbility={openAbility} />, "Leaves proposed from the nearest decided spellings, grouped by alike wording.")}
      {view === "shapes" && panel("Shapes", <ShapesPage faction={faction} revision={revision} busy={busy}
        perform={(work) => void perform(work)} reviewer={REVIEWER} onBatch={(batchId) => setBatches((current) => [...current, batchId])}
        openAbility={openAbility} setStatus={setStatus} />, "Approve how leaves combine once for every source with that shape.")}
      {view === "publish" && panel("Publish", <PublishPage revision={revision} busy={busy} perform={(work) => void perform(work)} setStatus={setStatus} />,
        "Write approved entries into tracked data. Commit the result with jj yourself.")}
      {view === "dashboard" && panel("Coverage census", <><div className="wb-actions"><button className="secondary" disabled={busy} onClick={refreshSourceStore}>Refresh sources from the store</button></div><p className="wb-help">Current source versions only. Confirmed leaf coverage and machine proposals are separate; whole-reviewed coverage is an independent safety gate. Missing denominators remain unknown.</p>{dashboard ? <MetricValue value={dashboard} /> : <p role="status">{loading ? "Loading recorded coverage…" : "Coverage unavailable. Reload to retry."}</p>}</>)}
    </main>
  </div>;
}
