import { useEffect, useState } from "react";

import { LeafForm, leafLabel, type Family } from "./LeafForm";
import { SplitEditor } from "./SplitEditor";
import { api } from "./workbench-api";

type Surface = { surface_id: number | null; surface: string; sample_text: string; annotations: number; pending: number; sources: number; warnings?: string[] };
type Leaf = { fingerprint_id: string; family_id: string; family_version: number; role: string; parameters: Record<string, unknown>; retired_version: boolean; surfaces: Surface[]; describer_gaps?: string[] };
type Wording = { surface: string; sample_text: string; occurrences: number; unlocks?: number; sample_ability_version_id: number };
type Board = { leaves: Leaf[]; unlabeled: Wording[]; untiled: Wording[]; totals: { current_sources: number; tiled_sources: number; sources_with_leaves: number } };
type ApplyReport = { batch_id: string; applied: number; already: number; blocked: Array<{ faction_id: string; ability_id: string; reason: string }> };

const ROLE_ORDER = ["CONDITION", "EVENT", "EFFECT", "DURATION", "COMBINATOR"];
const BLOCK_REASONS: Record<string, string> = { OTHER_LEAF_HERE: "another leaf already covers this text", REJECTED_HERE: "a reviewer rejected this meaning here" };

/**
 * Leaves: each meaning once, with every spelling GW uses for it. Deciding a spelling applies it
 * to every current source; the ranked list below shows which wording to decide next.
 */
export function LeavesPage({ families, faction, revision, busy, perform, reviewer, onBatch, openAbility, setStatus }: {
  families: readonly Family[];
  faction: string;
  revision: number;
  busy: boolean;
  perform: (work: () => Promise<void>) => void;
  reviewer: string;
  onBatch: (batchId: string) => void;
  openAbility: (id: number) => void;
  setStatus: (text: string) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  const [lastBlocked, setLastBlocked] = useState<ApplyReport["blocked"]>([]);
  /** Bumped after this page's own decisions so the board never shows the state before them. */
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api<Board>(`/leaves${faction ? `?faction=${encodeURIComponent(faction)}` : ""}`, undefined, controller.signal)
      .then(setBoard)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [faction, revision, reloads]);

  function report(result: ApplyReport, what: string) {
    onBatch(result.batch_id);
    setReloads((value) => value + 1);
    setLastBlocked(result.blocked);
    setEditing(null);
    setStatus(`${what}: ${result.applied} new occurrence${result.applied === 1 ? "" : "s"} annotated, ${result.already} already had it${result.blocked.length ? `, ${result.blocked.length} left alone (listed below)` : ""}. Undo reverses the whole decision.`);
  }
  const decide = (exactText: string, familyId: string, parameters: Record<string, unknown>) => perform(async () => {
    report(await api<ApplyReport>("/leaves/confirm", { reviewer, exact_text: exactText, family_id: familyId, parameters }), `“${exactText}” decided everywhere`);
  });
  const apply = (surface: Surface) => perform(async () => {
    report(await api<ApplyReport>("/leaves/apply", { reviewer, surface_ids: [surface.surface_id] }), `“${surface.sample_text}” applied`);
  });
  const move = (surface: Surface, familyId: string, parameters: Record<string, unknown>) => perform(async () => {
    report(await api<ApplyReport>("/leaves/move", { reviewer, surface_id: surface.surface_id, family_id: familyId, parameters }), `“${surface.sample_text}” moved`);
  });
  const retire = (surface: Surface) => perform(async () => {
    const result = await api<{ batch_id: string }>("/leaves/retire", { reviewer, surface_id: surface.surface_id });
    onBatch(result.batch_id);
    setReloads((value) => value + 1);
    setStatus(`“${surface.sample_text}” no longer applies to new text. Existing annotations stay.`);
  });
  const merge = (leaf: Leaf) => perform(async () => {
    const target = mergeTarget[leaf.fingerprint_id];
    if (!target) return;
    const result = await api<{ batch_id: string; surfaces: number; annotations: number }>("/leaves/merge", { reviewer, from_fingerprint_id: leaf.fingerprint_id, to_fingerprint_id: target });
    onBatch(result.batch_id);
    setReloads((value) => value + 1);
    setStatus(`Merged: ${result.surfaces} spelling${result.surfaces === 1 ? "" : "s"} and annotations in ${result.annotations} source${result.annotations === 1 ? "" : "s"} now share one leaf.`);
  });

  if (error) return <p role="alert" className="error">{error}</p>;
  if (!board) return <p role="status">Loading leaves…</p>;
  const wordingRow = (item: Wording, key: string, role: string | null) => <li key={key} className="wb-wording">
    <div><blockquote>{item.sample_text}</blockquote>
      <small>{item.unlocks ? `finishes ${item.unlocks} source${item.unlocks === 1 ? "" : "s"} · ` : ""}appears {item.occurrences}×</small></div>
    {editing === key
      ? <LeafForm families={families} exactText={item.sample_text} role={role} busy={busy} submitLabel="Decide everywhere"
        onSubmit={(familyId, parameters) => decide(item.sample_text, familyId, parameters)} onCancel={() => setEditing(null)} />
      : editing === `split:${key}`
        ? <SplitEditor text={item.sample_text} families={families} busy={busy} onDecide={decide} onCancel={() => setEditing(null)} />
      : <div className="wb-actions">
        <button className="primary" onClick={() => setEditing(key)}>Name this leaf</button>
        <button className="secondary" onClick={() => setEditing(`split:${key}`)}>Split into leaves</button>
        <button className="text-button" onClick={() => openAbility(item.sample_ability_version_id)}>Open a source</button>
      </div>}
  </li>;

  return <div className="wb-leaves">
    <p className="wb-progress-strip">
      <strong>{board.totals.tiled_sources}</strong> of {board.totals.current_sources} sources are fully described by leaves ·{" "}
      {board.totals.sources_with_leaves} have at least one leaf
    </p>
    {lastBlocked.length > 0 && <details className="wb-blocked" open><summary>{lastBlocked.length} occurrence{lastBlocked.length === 1 ? "" : "s"} left alone</summary>
      <ul>{lastBlocked.map((item, index) => <li key={index}>{item.faction_id}/{item.ability_id}: {BLOCK_REASONS[item.reason] ?? item.reason}</li>)}</ul></details>}

    <section>
      <h2>Wording that needs a leaf</h2>
      <p className="wb-help">Text no leaf covers yet, ranked by how many sources it would finish. Name it once; it applies wherever the same words appear.</p>
      <ol className="wb-wording-list">{board.untiled.map((item) => wordingRow(item, `untiled:${item.surface}`, null))}</ol>
      {!board.untiled.length && <p className="wb-help">Every source with a leaf is fully described.</p>}
    </section>

    {board.unlabeled.length > 0 && <section>
      <h2>Proposed spans without a meaning</h2>
      <ol className="wb-wording-list">{board.unlabeled.map((item) => wordingRow(item, `unlabeled:${item.surface}`, null))}</ol>
    </section>}

    <section>
      <h2>Leaves</h2>
      <p className="wb-help">One row per meaning. Each spelling under it is decided for the whole corpus, or still pending (proposed, not yet decided).</p>
      {ROLE_ORDER.map((role) => {
        const group = board.leaves.filter((leaf) => leaf.role === role);
        if (!group.length) return null;
        return <div key={role} className="wb-leaf-role"><h3>{role.toLowerCase()}</h3>
          {group.map((leaf) => <article key={leaf.fingerprint_id} className="wb-leaf">
            <header><strong>{leafLabel(families, leaf.family_id, leaf.parameters)}</strong>
              {leaf.retired_version && <span className="wb-state wb-state-blocked">retired family version</span>}
              {leaf.describer_gaps?.map((gap) => <small key={gap} className="wb-state wb-state-blocked">{gap}</small>)}</header>
            <ul className="wb-surfaces">{leaf.surfaces.map((surface) => {
              const key = `surface:${leaf.fingerprint_id}:${surface.surface}`;
              return <li key={surface.surface}>
                <span className="wb-surface-text">“{surface.sample_text}”</span>
                <small>{surface.surface_id ? "decided everywhere" : "not decided"} · {surface.annotations} annotated{surface.pending ? ` · ${surface.pending} pending` : ""} · {surface.sources} source{surface.sources === 1 ? "" : "s"}</small>
                {surface.warnings?.map((warning) => <small key={warning} className="wb-state wb-state-blocked">{warning}</small>)}
                <span className="wb-actions">
                  {!surface.surface_id && <button className="primary" disabled={busy || leaf.retired_version} onClick={() => decide(surface.sample_text, leaf.family_id, leaf.parameters)}>Decide everywhere</button>}
                  {surface.surface_id && surface.pending > 0 && <button className="primary" disabled={busy} onClick={() => apply(surface)}>Apply to {surface.pending} pending</button>}
                  {surface.surface_id && <button className="secondary" onClick={() => setEditing(key)}>Change meaning</button>}
                  {surface.surface_id && <button className="text-button" disabled={busy} onClick={() => retire(surface)}>Stop applying</button>}
                </span>
                {editing === key && <LeafForm families={families} exactText={surface.sample_text} role={leaf.role} busy={busy} submitLabel="Move this spelling"
                  initial={{ family_id: leaf.family_id, parameters: leaf.parameters }}
                  onSubmit={(familyId, parameters) => move(surface, familyId, parameters)} onCancel={() => setEditing(null)} />}
              </li>;
            })}</ul>
            {group.length > 1 && <div className="wb-actions">
              <select aria-label="Merge into" value={mergeTarget[leaf.fingerprint_id] ?? ""} onChange={(event) => setMergeTarget((current) => ({ ...current, [leaf.fingerprint_id]: event.target.value }))}>
                <option value="">Same meaning as…</option>
                {group.filter((other) => other.fingerprint_id !== leaf.fingerprint_id).map((other) => <option key={other.fingerprint_id} value={other.fingerprint_id}>{leafLabel(families, other.family_id, other.parameters)}</option>)}
              </select>
              <button className="secondary" disabled={busy || !mergeTarget[leaf.fingerprint_id]} onClick={() => merge(leaf)}>Merge into it</button>
            </div>}
          </article>)}
        </div>;
      })}
    </section>
  </div>;
}
