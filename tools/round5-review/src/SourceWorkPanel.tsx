import { useEffect, useState } from "react";

import { api } from "./workbench-api";

const STRUCTURAL_KINDS = ["participant", "selector", "usage", "binding"] as const;
const CONNECTIVE_KINDS = ["and", "or", "if", "unless", "while", "until", "during", "before", "after", "then", "reference", "other"] as const;
const KIND_HELP: Record<string, string> = {
  participant: "who acts or is affected",
  selector: "which entities qualify",
  usage: "a use limit or cost",
  binding: "what a phrase refers or attaches to",
};

type Interval = { fragment: string; start_byte: number; end_byte: number; exact_text: string };
type ReadinessReason = { code: string; count: number; message: string };
type AtomProposal = Interval & { id: number; kind: string; status: string; origin: string; description: string; parent_proposal_id: number | null };
type AtomReview = Interval & { id: number; proposal_id: number; kind: string; contained_by_annotation_id: number | null; supported: boolean; batch_id: string };
type LunaRun = {
  run_id: string;
  state: "prepared" | "claimed" | "completed" | "failed";
  model: string;
  model_version: string;
  started_at: string | null;
  abandonable_at: string | null;
  failure: { stage: string; reason_code: string; message: string } | null;
  summary: { proposals: number; unresolved: number; structural: number; candidates: number } | null;
  successor_run_id: number | null;
};

/** The fields of an ability view this panel reads. */
export type SourceWorkAbility = {
  id: number;
  source_hash: string;
  review_evidence_hash: string;
  composition_escalation_id: string | null;
  annotations: Array<Interval & { id: number; role: string }>;
  coverage: {
    leaf_fraction: number;
    accounted_fraction: number;
    leaf_bytes: { numerator: number; denominator: number };
    accounted_bytes: { numerator: number; denominator: number };
    partition: Record<"leaf" | "structural" | "connective" | "pending" | "unresolved" | "residue", number>;
    overlaps: Array<{ kind: string; bytes: number; sanctioned: boolean }>;
  };
  progress: { readiness: { ready: boolean; whole_context_checked: boolean; composition_eligible: boolean; reasons: ReadinessReason[] } };
  atoms: { proposals: AtomProposal[]; reviews: AtomReview[] };
};

const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;

export function SourceWorkPanel({ ability, selection, busy, perform, reviewer, onBatch, onChanged, onCompose, setStatus }: {
  ability: SourceWorkAbility;
  selection: Interval | null;
  busy: boolean;
  perform: (work: () => Promise<void>, expectsRevision?: boolean) => void;
  reviewer: string;
  onBatch: (batchId: string) => void;
  onChanged: () => Promise<void>;
  /** Generate a source-bound composition proposal for this ability's open composition gap. */
  onCompose: (escalationId: string) => void;
  setStatus: (text: string) => void;
}) {
  const [run, setRun] = useState<LunaRun | null>(null);
  const [abandonReason, setAbandonReason] = useState("");
  const [labelKind, setLabelKind] = useState<string>("participant");
  const [connectiveKind, setConnectiveKind] = useState<string>("and");
  const [description, setDescription] = useState("");
  const [corrections, setCorrections] = useState<Record<number, string>>({});
  const [containers, setContainers] = useState<Record<number, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    setRun(null);
    api<{ run: LunaRun | null }>(`/abilities/${ability.id}/luna-run`, undefined, controller.signal)
      .then((result) => setRun(result.run))
      .catch(() => undefined);
    return () => controller.abort();
  }, [ability.id]);

  // A claimed run finishes in the server; poll until it reaches a terminal state.
  useEffect(() => {
    if (run?.state !== "claimed") return;
    const timer = window.setInterval(() => {
      api<LunaRun>(`/luna/runs/${run.run_id}`).then((next) => {
        setRun(next);
        if (next.state === "completed") {
          setStatus(`Luna returned ${next.summary?.proposals ?? 0} pending proposals, ${next.summary?.structural ?? 0} structural suggestions, and ${next.summary?.unresolved ?? 0} unresolved claims. Nothing is confirmed yet.`);
          void onChanged();
        } else if (next.state === "failed") {
          setStatus(`Luna run ${next.run_id} failed: ${next.failure?.reason_code}. No proposals were imported.`);
          void onChanged();
        }
      }).catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [run?.run_id, run?.state]);

  const readiness = ability.progress.readiness;
  const coverage = ability.coverage;
  const running = run?.state === "claimed";

  function analyze(retryOf?: number) {
    perform(async () => {
      const prepared = await api<{ run_id: string }>("/luna/prepare", {
        ability_version_id: ability.id,
        mode: coverage.partition.pending + coverage.partition.unresolved > 0 ? "residue" : "coverage",
        limit: 1,
        ...(retryOf ? { retry_of: retryOf } : {}),
      });
      const started = await api<LunaRun>("/luna/run", { run_id: prepared.run_id });
      setRun(started);
      setStatus(`Luna run ${started.run_id} is analyzing this source. It can take several minutes; results stay pending until you review them.`);
    });
  }

  function checkWholeSource() {
    perform(async () => {
      await api(`/abilities/${ability.id}/review`, {
        source_hash: ability.source_hash, expected_review_hash: ability.review_evidence_hash, reviewer, whole_context_checked: true,
      });
      setStatus("Whole-context check recorded and a composition gap opened. Generate the composition proposal next.");
      await onChanged();
    });
  }

  function abandon() {
    if (!run || !abandonReason.trim()) return;
    perform(async () => {
      setRun(await api<LunaRun>("/luna/abandon", { run_id: run.run_id, reason: abandonReason.trim() }));
      setAbandonReason("");
      setStatus("Run closed as failed. Retry prepares a new, linked run.");
    });
  }

  function propose(kind: string) {
    if (!selection || !description.trim()) return;
    perform(async () => {
      const result = await api<{ batch_id: string; kind: string }>("/source-atoms/propose", {
        ability_version_id: ability.id, source_hash: ability.source_hash, ...selection, kind,
        description: description.trim(), reviewer, ...(kind === "CONNECTIVE" ? { connective_kind: connectiveKind } : {}),
      });
      onBatch(result.batch_id);
      setDescription("");
      setStatus(kind === "UNRESOLVED"
        ? "Recorded an unresolved claim and its leaf gap. It blocks composition until resolved."
        : `Recorded a pending ${kind === "CONNECTIVE" ? "connective" : kind} proposal. Accept it separately to account for these bytes.`);
      await onChanged();
    });
  }

  function decide(proposal: AtomProposal, action: "accept" | "correct" | "reject") {
    perform(async () => {
      const container = containers[proposal.id];
      const result = await api<{ batch_id: string }>("/source-atoms/batch", {
        reviewer,
        decisions: [{
          atom_proposal_id: proposal.id, action, source_hash: ability.source_hash,
          ...(action === "correct" ? { kind: corrections[proposal.id] ?? proposal.kind } : {}),
          ...(action !== "reject" && container ? { contained_by_annotation_id: Number(container) } : {}),
        }],
      });
      onBatch(result.batch_id);
      setStatus(action === "reject" ? "Structural proposal rejected." : "Structural constituent reviewed; its bytes now count as accounted source.");
      await onChanged();
    });
  }

  const pendingAtoms = ability.atoms.proposals;
  return <section className="wb-source-work" aria-label="Source accounting and decomposition">
    <h3>Source accounting</h3>
    <dl className="wb-inline-facts">
      <div><dt>Accounted</dt><dd>{percent(coverage.accounted_fraction)} ({coverage.accounted_bytes.numerator}/{coverage.accounted_bytes.denominator} bytes)</dd></div>
      <div><dt>Reviewed leaf</dt><dd>{percent(coverage.leaf_fraction)} ({coverage.leaf_bytes.numerator}/{coverage.leaf_bytes.denominator})</dd></div>
    </dl>
    <div className="wb-partition" role="img" aria-label="Exclusive byte partition">
      {(["leaf", "structural", "connective", "pending", "unresolved", "residue"] as const).map((layer) => coverage.partition[layer] > 0
        && <span key={layer} className={`wb-partition-${layer}`} style={{ flexGrow: coverage.partition[layer] }} title={`${layer}: ${coverage.partition[layer]} bytes`}>{layer} {coverage.partition[layer]}</span>)}
    </div>
    {coverage.overlaps.some((overlap) => !overlap.sanctioned) && <p className="error">Unsanctioned overlap: {coverage.overlaps.filter((overlap) => !overlap.sanctioned).map((overlap) => `${overlap.kind} (${overlap.bytes} bytes)`).join(", ")}.</p>}
    {readiness.ready
      ? <p className="wb-reviewed">{readiness.whole_context_checked ? "Composition eligible: every byte is reviewed and the whole source is checked." : "Every meaningful byte is reviewed. Read the complete source above, then record the check."}</p>
      : <ul className="wb-readiness">{readiness.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul>}
    {readiness.ready && !readiness.whole_context_checked && <div className="wb-actions">
      <button className="primary" disabled={busy} onClick={checkWholeSource}>I checked the whole source; open composition</button>
    </div>}
    {readiness.composition_eligible && <div className="wb-actions">
      {ability.composition_escalation_id
        ? <button className="primary" disabled={busy} onClick={() => onCompose(ability.composition_escalation_id!)}>Generate composition proposal</button>
        : <p className="wb-help">No open composition gap for this source version. Clear and re-record the whole-context check to reopen one.</p>}
    </div>}

    <div className="wb-luna-run">
      <h4>Model decomposition</h4>
      {run && <p className="wb-help">Run {run.run_id}: <strong>{run.state}</strong>{run.state === "completed" ? ` · ${run.model} (${run.model_version})` : ""}{run.failure ? ` · ${run.failure.reason_code}: ${run.failure.message}` : ""}</p>}
      <div className="wb-actions">
        <button className="primary" disabled={busy || running || coverage.partition.residue === 0} onClick={() => analyze()}>{running ? "Analyzing…" : "Analyze source"}</button>
        {run?.state === "failed" && !run.successor_run_id && <button className="secondary" disabled={busy} onClick={() => analyze(Number(run.run_id))}>Retry as a new run</button>}
      </div>
      {coverage.partition.residue === 0 && !running && <p className="wb-help">No unclaimed source remains to send. Review the pending claims first.</p>}
      {run && (run.state === "claimed" || run.state === "prepared") && <div className="wb-actions">
        <input value={abandonReason} onChange={(event) => setAbandonReason(event.target.value)} placeholder="Reason to abandon" />
        <button className="secondary danger" disabled={busy || !abandonReason.trim()} onClick={abandon}>Abandon pending run</button>
        {run.state === "claimed" && run.abandonable_at && <small>Abandonable after {new Date(run.abandonable_at).toLocaleTimeString()}</small>}
      </div>}
    </div>

    {selection && <div className="wb-label-selection">
      <h4>Label the selection without a model</h4>
      <blockquote>{selection.exact_text}</blockquote>
      <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this constituent does in the rule" /></label>
      <div className="wb-actions">
        <select value={labelKind} onChange={(event) => setLabelKind(event.target.value)}>{STRUCTURAL_KINDS.map((kind) => <option key={kind} value={kind}>{kind}: {KIND_HELP[kind]}</option>)}</select>
        <button className="secondary" disabled={busy || !description.trim()} onClick={() => propose(labelKind)}>Propose structural constituent</button>
      </div>
      <div className="wb-actions">
        <select value={connectiveKind} onChange={(event) => setConnectiveKind(event.target.value)}>{CONNECTIVE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select>
        <button className="secondary" disabled={busy || !description.trim()} onClick={() => propose("CONNECTIVE")}>Propose connective</button>
        <button className="secondary" disabled={busy || !description.trim()} onClick={() => propose("UNRESOLVED")}>Mark unresolved</button>
      </div>
    </div>}

    {pendingAtoms.length > 0 && <div className="wb-atom-list">
      <h4>Pending structural proposals · {pendingAtoms.length}</h4>
      {pendingAtoms.map((proposal) => {
        const parents = ability.annotations.filter((annotation) => annotation.fragment === proposal.fragment
          && annotation.start_byte <= proposal.start_byte && annotation.end_byte >= proposal.end_byte);
        return <article key={proposal.id} className="wb-atom">
          <header><strong>{proposal.kind}</strong><small>{proposal.origin} · {proposal.fragment} {proposal.start_byte}–{proposal.end_byte}</small></header>
          <blockquote>{proposal.exact_text}</blockquote>
          <p className="wb-help">{proposal.description}</p>
          {parents.length > 0 && <label>Reviewed qualifier inside<select value={containers[proposal.id] ?? ""} onChange={(event) => setContainers((current) => ({ ...current, [proposal.id]: event.target.value }))}>
            <option value="">Not contained</option>{parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.role} · {parent.exact_text}</option>)}
          </select></label>}
          <div className="wb-actions">
            <button className="primary" disabled={busy} onClick={() => decide(proposal, "accept")}>Accept</button>
            <select value={corrections[proposal.id] ?? proposal.kind} onChange={(event) => setCorrections((current) => ({ ...current, [proposal.id]: event.target.value }))}>{STRUCTURAL_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select>
            <button className="secondary" disabled={busy || (corrections[proposal.id] ?? proposal.kind) === proposal.kind} onClick={() => decide(proposal, "correct")}>Correct kind</button>
            <button className="secondary danger" disabled={busy} onClick={() => decide(proposal, "reject")}>Reject</button>
          </div>
        </article>;
      })}
    </div>}
    {ability.atoms.reviews.length > 0 && <details className="wb-atom-list"><summary>Reviewed structure · {ability.atoms.reviews.length}</summary>
      {ability.atoms.reviews.map((review) => <p key={review.id}><strong>{review.kind}</strong> “{review.exact_text}” <small>{review.fragment} {review.start_byte}–{review.end_byte}{review.contained_by_annotation_id ? ` · inside annotation ${review.contained_by_annotation_id}` : ""}{review.supported ? "" : " · parent retracted, not counted"}</small></p>)}
    </details>}
  </section>;
}
