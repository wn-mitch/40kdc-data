import { useEffect, useState } from "react";

import { api } from "./workbench-api";

type Rule = {
  stamp_id: string; revision: number; label: string; status: string; challenge: string | null; challenge_findings: string[];
  approvable: boolean; blocker: string | null; preview_status: string;
  graph: { nodes: Array<{ id: string; kind: string; family: string | null; parameters: unknown }>; relations: Array<{ type: string; from: string; to: string }> } | null;
  mechanics: unknown; rendered_text: string | null; errors: string[]; warnings: string[];
};
type RoundTrip = {
  decomposition: Array<{ kind: string; text: string; label: string; detail: unknown }>;
  current: { rendered_text: string | null; effect: unknown; error: string | null };
  rules: Rule[];
  drafts: Array<{ id: string; status: string; rendered_text: string | null; diagnostic: Record<string, unknown>; stamp_id: string; stamp_revision: number }>;
};

const compact = (value: unknown): string => value === null || value === undefined ? "" : JSON.stringify(value);

/**
 * The composition round trip for one source: the reviewed decomposition, what the authored
 * DSL says today, and what each matching rule would produce and render as.
 */
export function RoundTripView({ abilityVersionId, revision, openStamp }: {
  abilityVersionId: number;
  revision: number;
  openStamp: (stampId: string, revision: number) => void;
}) {
  const [trip, setTrip] = useState<RoundTrip | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api<RoundTrip>(`/abilities/${abilityVersionId}/round-trip`, undefined, controller.signal)
      .then(setTrip)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [abilityVersionId, revision]);

  if (error) return <p className="error">{error}</p>;
  if (!trip) return <p className="wb-help">Loading the round trip…</p>;
  return <div className="wb-round-trip">
    <h4>Reviewed decomposition</h4>
    <ul className="wb-decomposition">{trip.decomposition.map((part, index) => <li key={index}>
      <span className={`wb-part wb-part-${part.kind}`}>“{part.text}”</span> <small>{part.label}{part.detail ? ` ${compact(part.detail)}` : ""}</small>
    </li>)}</ul>

    <h4>Round trip back to English</h4>
    <dl className="wb-trip-lines">
      <div><dt>Authored DSL today</dt><dd>{trip.current.rendered_text ?? trip.current.error ?? "No authored DSL"}</dd></div>
      {trip.rules.map((rule) => <div key={`${rule.stamp_id}@${rule.revision}`} className={rule.warnings.length || rule.errors.length ? "wb-trip-warn" : ""}>
        <dt>Rule “{rule.label}” · <span className={`wb-state wb-state-${rule.status}`}>{rule.status}</span> · challenge {rule.challenge ?? "n/a"}</dt>
        <dd>
          <strong>{rule.rendered_text ?? "Does not render"}</strong>
          {rule.warnings.map((warning) => <p key={warning} className="error">⚠ {warning}</p>)}
          {rule.errors.map((message) => <p key={message} className="error">{message}</p>)}
          {rule.challenge_findings.length > 0 && <p className="wb-help">Challenger: {rule.challenge_findings.join(" · ")}</p>}
          {rule.blocker && rule.status === "proposed" && <p className="wb-help">Approval blocked: {rule.blocker}</p>}
          <details><summary>Graph and mechanics</summary>
            {rule.graph && <ul className="wb-decomposition">
              {rule.graph.nodes.map((node) => <li key={node.id}><code>{node.id}</code> {node.kind}{node.family ? ` · ${node.family}` : ""} <small>{compact(node.parameters)}</small></li>)}
              {rule.graph.relations.map((relation, index) => <li key={`r${index}`}><code>{relation.from}</code> {relation.type} <code>{relation.to}</code></li>)}
            </ul>}
            <pre className="wb-artifact">{JSON.stringify(rule.mechanics, null, 2)}</pre>
          </details>
          <button className="text-button" onClick={() => openStamp(rule.stamp_id, rule.revision)}>Open rule in Stamps</button>
        </dd>
      </div>)}
      {trip.drafts.map((draft) => <div key={draft.id}><dt>Draft · <span className={`wb-state wb-state-${draft.status}`}>{draft.status}</span></dt>
        <dd>{draft.rendered_text ?? String(draft.diagnostic.message ?? "No rendering")}</dd></div>)}
    </dl>
    {trip.rules.length === 0 && <p className="wb-help">No composition rule matches this source yet. Firing it below asks for one; you will see its rendering here before approving anything.</p>}
  </div>;
}
