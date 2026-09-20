import { useEffect, useState } from "react";

import { api } from "./workbench-api";

type Verdict = "suggested" | "supports" | "counterexample" | "insufficient";
type Summary = {
  id: number; role: string; label: string; distinction: string; parameter_hints: string[];
  state: "open" | "mapped" | "dismissed"; mapped_family: { id: string; version: number } | null;
  current: Record<Verdict, number>; stale: number; factions: string[];
};
type Occurrence = {
  span_id: number; ability_version_id: number; faction_id: string; ability_id: string; fragment: string;
  start_byte: number; end_byte: number; exact_text: string; current: boolean; proposal_id: number | null; proposal_status: string | null;
  effective: { evidence_id: number; verdict: Verdict; reviewer: string | null; explanation: string | null };
  history: Array<{ evidence_id: number; verdict: Verdict; reviewer: string | null; explanation: string | null; revoked: boolean; created_at: string }>;
};
type Detail = Summary & {
  occurrences: Occurrence[];
  revision: number;
  promotion: { existing_families: Array<{ id: string; version: number; label: string }>; new_family_steps: string[] };
};

/**
 * Provisional family candidates grouped from NOVEL source forms. Judgments, dismissal, and
 * mapping are human decisions recorded per occurrence; none of them creates a reviewed family.
 */
export function OntologyPanel({ faction, busy, perform, reviewer, revision, onBatch, openAbility, setStatus }: {
  faction: string;
  busy: boolean;
  perform: (work: () => Promise<void>, expectsRevision?: boolean) => void;
  reviewer: string;
  revision: number;
  onBatch: (batchId: string) => void;
  openAbility: (id: number, proposalId?: number) => void;
  setStatus: (text: string) => void;
}) {
  const [candidates, setCandidates] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [explanations, setExplanations] = useState<Record<number, string>>({});
  const [mapFamily, setMapFamily] = useState("");
  const [mapParameters, setMapParameters] = useState<Record<number, string>>({});
  const [mapSelected, setMapSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    api<{ candidates: Summary[] }>(`/ontology${faction ? `?faction=${encodeURIComponent(faction)}` : ""}`, undefined, controller.signal)
      .then((result) => {
        setCandidates(result.candidates);
        setSelected((current) => current ?? result.candidates[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [faction, revision]);

  useEffect(() => {
    if (selected === null) { setDetail(null); return; }
    const controller = new AbortController();
    api<Detail>(`/family-candidates/${selected}`, undefined, controller.signal).then(setDetail).catch(() => undefined);
    return () => controller.abort();
  }, [selected, revision]);

  function judge(occurrence: Occurrence, verdict: Exclude<Verdict, "suggested">) {
    if (!detail) return;
    const explanation = explanations[occurrence.span_id]?.trim();
    if (!explanation) return;
    perform(async () => {
      const result = await api<{ batch_id: string }>(`/family-candidates/${detail.id}/judge`, {
        evidence_id: occurrence.effective.evidence_id, verdict, explanation, reviewer, expected_revision: detail.revision,
      });
      onBatch(result.batch_id);
      setExplanations((current) => ({ ...current, [occurrence.span_id]: "" }));
      setStatus(`Recorded ${verdict} for one occurrence. It is evidence, not a family.`);
    });
  }

  function changeState(state: "open" | "dismissed") {
    if (!detail) return;
    perform(async () => {
      const result = await api<{ batch_id: string }>(`/family-candidates/${detail.id}/state`, { state, reviewer, expected_revision: detail.revision });
      onBatch(result.batch_id);
      setStatus(state === "dismissed" ? "Candidate dismissed; its evidence is kept." : "Candidate reopened.");
    });
  }

  function map() {
    if (!detail || !mapFamily) return;
    const [familyId, version] = mapFamily.split("@");
    perform(async () => {
      const occurrences = detail.occurrences.filter((item) => item.proposal_id !== null && mapSelected.has(item.proposal_id)).map((item) => {
        const parsed: unknown = JSON.parse(mapParameters[item.proposal_id!] ?? "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Parameters must be a JSON object.");
        return { proposal_id: item.proposal_id, parameters: parsed };
      });
      const result = await api<{ batch_id: string; proposals: number[] }>(`/family-candidates/${detail.id}/map`, {
        family_id: familyId, family_version: Number(version), occurrences, reviewer, expected_revision: detail.revision,
      });
      onBatch(result.batch_id);
      setMapSelected(new Set());
      setStatus(`Re-entered ${result.proposals.length} supported occurrence${result.proposals.length === 1 ? "" : "s"} as pending ${familyId} proposals. Confirm each one, then resolve its original novel proposal.`);
    });
  }

  return <div className="wb-registry-layout">
    <aside className="wb-registry-list" aria-label="Provisional family candidates">
      <p className="wb-help">{candidates.length} candidates. Counts are current source only.</p>
      {candidates.map((item) => <button key={item.id} className={selected === item.id ? "current" : ""} onClick={() => setSelected(item.id)}>
        <span><strong>{item.label}</strong><small>{item.role} · {item.current.supports} supports · {item.current.counterexample} counter · {item.current.suggested} suggested{item.stale ? ` · ${item.stale} stale` : ""}</small></span>
        <span className={`wb-state wb-state-${item.state === "open" ? "proposed" : item.state === "mapped" ? "approved" : "rejected"}`}>{item.state}</span>
      </button>)}
      {!candidates.length && <p className="wb-help">No NOVEL source forms yet. They appear when Luna or a reviewer marks a leaf novel.</p>}
    </aside>
    <section className="wb-registry-detail">{detail ? <>
      <header className="wb-detail-heading"><div><p className="eyebrow">{detail.role} candidate · not a reviewed family</p><h2>{detail.label}</h2><p className="wb-help">{detail.distinction}</p></div>
        <span className={`wb-state wb-state-${detail.state === "open" ? "proposed" : "approved"}`}>{detail.mapped_family ? `mapped to ${detail.mapped_family.id}@${detail.mapped_family.version}` : detail.state}</span></header>
      {detail.parameter_hints.length > 0 && <p className="wb-help">Parameter hints: {detail.parameter_hints.join(", ")}</p>}
      <div className="wb-actions">
        {detail.state === "open" && <button className="secondary" disabled={busy} onClick={() => changeState("dismissed")}>Dismiss</button>}
        {detail.state === "dismissed" && <button className="secondary" disabled={busy} onClick={() => changeState("open")}>Reopen</button>}
      </div>
      {detail.occurrences.map((item) => <article key={item.span_id} className={`wb-occurrence${item.current ? "" : " stale"}`}>
        <header><strong>{item.faction_id}/{item.ability_id}</strong><span className={`wb-state wb-state-${item.effective.verdict === "supports" ? "approved" : item.effective.verdict === "counterexample" ? "blocked" : "proposed"}`}>{item.effective.verdict}</span>{!item.current && <span className="wb-state wb-state-stale">stale source</span>}</header>
        <blockquote>{item.exact_text}</blockquote>
        <small>{item.fragment} · bytes {item.start_byte}–{item.end_byte} · proposal {item.proposal_id ?? "none"} ({item.proposal_status ?? "n/a"})</small>
        <button className="text-button" onClick={() => openAbility(item.ability_version_id, item.proposal_id ?? undefined)}>Inspect whole ability</button>
        {item.current && detail.state !== "dismissed" && <div className="wb-actions">
          <input value={explanations[item.span_id] ?? ""} onChange={(event) => setExplanations((current) => ({ ...current, [item.span_id]: event.target.value }))} placeholder="Why, for this occurrence" />
          {(["supports", "counterexample", "insufficient"] as const).map((verdict) => <button key={verdict} className="secondary" disabled={busy || !explanations[item.span_id]?.trim()} onClick={() => judge(item, verdict)}>{verdict}</button>)}
        </div>}
        {detail.state === "open" && item.current && item.effective.verdict === "supports" && item.proposal_id !== null && <label className="wb-check">
          <input type="checkbox" checked={mapSelected.has(item.proposal_id)} onChange={(event) => setMapSelected((current) => {
            const next = new Set(current);
            if (event.target.checked) next.add(item.proposal_id!); else next.delete(item.proposal_id!);
            return next;
          })} /><span>Map this supported occurrence</span></label>}
        {mapSelected.has(item.proposal_id ?? -1) && <label>Parameters JSON<textarea rows={3} value={mapParameters[item.proposal_id!] ?? "{}"} onChange={(event) => setMapParameters((current) => ({ ...current, [item.proposal_id!]: event.target.value }))} spellCheck={false} /></label>}
        <details><summary>Evidence history · {item.history.length}</summary>{item.history.map((entry) => <p key={entry.evidence_id}>{entry.verdict}{entry.revoked ? " (revoked)" : ""} · {entry.reviewer ?? "model suggestion"} · {entry.explanation ?? ""}</p>)}</details>
      </article>)}
      {detail.state === "open" && <section className="wb-work-step">
        <h3>Map to an existing reviewed family</h3>
        <p className="wb-help">Only current, human-supported occurrences re-enter, as pending proposals you confirm one by one. Their original novel proposals and gaps stay open for their own decisions.</p>
        <div className="wb-actions"><select value={mapFamily} onChange={(event) => setMapFamily(event.target.value)}><option value="">Choose a {detail.role} family</option>
          {detail.promotion.existing_families.map((family) => <option key={`${family.id}@${family.version}`} value={`${family.id}@${family.version}`}>{family.label} ({family.id}@{family.version})</option>)}</select>
          <button className="primary" disabled={busy || !mapFamily || mapSelected.size === 0} onClick={map}>Map {mapSelected.size} selected</button></div>
        <h3>Genuinely new family</h3>
        <p className="wb-help">A new family is an ontology stop. It needs a maintainer code change before any occurrence can be reviewed as that family:</p>
        <ol>{detail.promotion.new_family_steps.map((step) => <li key={step}>{step}</li>)}</ol>
      </section>}
    </> : <div className="wb-empty"><h2>Select a candidate</h2><p>Candidates collect novel source forms and their per-occurrence evidence.</p></div>}</section>
  </div>;
}
