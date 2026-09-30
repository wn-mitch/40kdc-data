import { useEffect, useState } from "react";

import { LeafForm, leafLabel, type Family } from "./LeafForm";
import { Examples } from "./Examples";
import { SplitEditor } from "./SplitEditor";
import type { DecisionQueue, QueueItem } from "./decision-queue";
import { alphabetical, api } from "./workbench-api";

type Surface = { surface_id: number | null; surface: string; sample_text: string; annotations: number; pending: number; sources: number; closes: number; warnings?: string[] };
type Leaf = { fingerprint_id: string; family_id: string; family_version: number; role: string; parameters: Record<string, unknown>; retired_version: boolean; surfaces: Surface[]; closes: number; occurrences: number; describer_gaps?: string[] };
type Wording = { surface: string; sample_text: string; occurrences: number; unlocks?: number; sample_ability_version_id: number };
type Board = { leaves: Leaf[]; unlabeled: Wording[]; untiled: Wording[]; totals: { current_sources: number; tiled_sources: number; sources_with_leaves: number } };
type ApplyReport = { batch_id: string; applied: number; already: number; blocked: Array<{ faction_id: string; ability_id: string; reason: string }> };

const ROLE_ORDER = ["RESTRICTION", "CONDITION", "EVENT", "EFFECT", "DURATION", "COMBINATOR"];
const BLOCK_REASONS: Record<string, string> = { OTHER_LEAF_HERE: "another leaf already covers this text", REJECTED_HERE: "a reviewer rejected this meaning here",
  QUALIFIED_HERE: "a word before it (melee, ranged, or a unit keyword) narrows the meaning; decide the longer wording" };

/**
 * Leaves: each meaning once, with every spelling GW uses for it. Deciding a spelling applies it
 * to every current source; the ranked list below shows which wording to decide next. Decisions go
 * through the shared queue, so the page stays usable while earlier ones are still being recorded.
 */
export function LeavesPage({ families, faction, revision, queue, queueItems, reviewer, openAbility, setStatus }: {
  families: readonly Family[];
  faction: string;
  revision: number;
  queue: DecisionQueue;
  queueItems: readonly QueueItem[];
  reviewer: string;
  openAbility: (id: number) => void;
  setStatus: (text: string) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  const [lastBlocked, setLastBlocked] = useState<ApplyReport["blocked"]>([]);

  /** Wordings recorded since the board was last loaded, kept hidden until a later load drops them. */
  const [settled, setSettled] = useState<ReadonlyMap<string, number>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    const started = Date.now();
    setError(null);
    api<Board>(`/leaves${faction ? `?faction=${encodeURIComponent(faction)}` : ""}`, undefined, controller.signal)
      .then((loaded) => {
        setBoard(loaded);
        setSettled((current) => new Map([...current].filter(([, at]) => at >= started)));
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [faction, revision]);

  const state = (key: string) => queueItems.find((item) => item.key === key) ?? null;
  const waiting = (key: string) => { const item = state(key); return item !== null && item.status !== "failed"; };
  function report(result: ApplyReport, what: string) {
    setLastBlocked((current) => [...current, ...result.blocked]);
    setStatus(`${what}: ${result.applied} new occurrence${result.applied === 1 ? "" : "s"} annotated, ${result.already} already had it${result.blocked.length ? `, ${result.blocked.length} left alone (listed below)` : ""}. Undo reverses the whole decision.`);
  }
  const send = (key: string, label: string, path: string, body: unknown, onDone: (result: unknown) => void) => {
    setEditing(null);
    queue.enqueue({ key, label, path, body, onDone });
  };
  const decide = (key: string, exactText: string, familyId: string, parameters: Record<string, unknown>) =>
    send(key, exactText, "/leaves/confirm", { reviewer, exact_text: exactText, family_id: familyId, parameters }, (result) => {
      setSettled((current) => new Map(current).set(key, Date.now()));
      report(result as ApplyReport, `“${exactText}” decided everywhere`);
    });
  const apply = (surface: Surface) => send(`apply:${surface.surface_id}`, surface.sample_text, "/leaves/apply", { reviewer, surface_ids: [surface.surface_id] },
    (result) => report(result as ApplyReport, `“${surface.sample_text}” applied`));
  const move = (surface: Surface, familyId: string, parameters: Record<string, unknown>) => send(`move:${surface.surface_id}`, surface.sample_text, "/leaves/move",
    { reviewer, surface_id: surface.surface_id, family_id: familyId, parameters }, (result) => report(result as ApplyReport, `“${surface.sample_text}” moved`));
  const retire = (surface: Surface) => send(`retire:${surface.surface_id}`, surface.sample_text, "/leaves/retire", { reviewer, surface_id: surface.surface_id },
    () => setStatus(`“${surface.sample_text}” no longer applies to new text. Existing annotations stay.`));
  const merge = (leaf: Leaf) => {
    const target = mergeTarget[leaf.fingerprint_id];
    if (!target) return;
    send(`merge:${leaf.fingerprint_id}`, leafLabel(families, leaf.family_id, leaf.parameters), "/leaves/merge", { reviewer, from_fingerprint_id: leaf.fingerprint_id, to_fingerprint_id: target }, (value) => {
      const result = value as { surfaces: number; annotations: number };
      setStatus(`Merged: ${result.surfaces} spelling${result.surfaces === 1 ? "" : "s"} and annotations in ${result.annotations} source${result.annotations === 1 ? "" : "s"} now share one leaf.`);
    });
  };
  /** A queued or running decision's label, or the server's reason when it failed. */
  const queueNote = (key: string) => {
    const item = state(key);
    if (!item) return null;
    return item.status === "failed"
      ? <small className="wb-state wb-state-blocked">not recorded: {item.error}</small>
      : <small className="wb-state wb-state-queued">{item.status === "running" ? "recording…" : "queued"}</small>;
  };

  if (error) return <p role="alert" className="error">{error}</p>;
  if (!board) return <p role="status">Loading leaves…</p>;
  // A wording whose decision is on its way is hidden; the refresh after the queue drains drops it for good.
  const wordingRow = (item: Wording, key: string, role: string | null) => waiting(`wording:${item.surface}`) || settled.has(`wording:${item.surface}`) ? null : <li key={key} className="wb-wording">
    <div><blockquote>{item.sample_text}</blockquote>
      <small>{item.unlocks ? `finishes ${item.unlocks} source${item.unlocks === 1 ? "" : "s"} · ` : ""}appears {item.occurrences}×</small>
      {queueNote(`wording:${item.surface}`)}
      <Examples text={item.sample_text} faction={faction} openAbility={openAbility} /></div>
    {editing === key
      ? <LeafForm families={families} exactText={item.sample_text} role={role} busy={false} submitLabel="Decide everywhere"
        onSubmit={(familyId, parameters) => decide(`wording:${item.surface}`, item.sample_text, familyId, parameters)} onCancel={() => setEditing(null)} />
      : editing === `split:${key}`
        ? <SplitEditor text={item.sample_text} families={families} busy={false} pieceState={(piece) => state(`piece:${piece.toLowerCase()}`)}
          onDecide={(piece, familyId, parameters) => queue.enqueue({ key: `piece:${piece.toLowerCase()}`, label: piece, path: "/leaves/confirm",
            body: { reviewer, exact_text: piece, family_id: familyId, parameters }, onDone: (result) => report(result as ApplyReport, `“${piece}” decided everywhere`) })}
          onCancel={() => setEditing(null)} />
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
    {lastBlocked.length > 0 && <details className="wb-blocked" open={lastBlocked.length <= 10}><summary>{lastBlocked.length} occurrence{lastBlocked.length === 1 ? "" : "s"} left alone
      {" "}<button className="text-button" onClick={() => setLastBlocked([])}>Clear</button></summary>
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
      <p className="wb-help">One row per meaning, those that would finish the most sources first. Each spelling under it is decided for the whole corpus, or still pending (proposed, not yet decided).</p>
      {ROLE_ORDER.map((role) => {
        const group = board.leaves.filter((leaf) => leaf.role === role);
        if (!group.length) return null;
        return <div key={role} className="wb-leaf-role"><h3>{role.toLowerCase()}</h3>
          {group.map((leaf) => <article key={leaf.fingerprint_id} className="wb-leaf">
            <header><strong>{leafLabel(families, leaf.family_id, leaf.parameters)}</strong>
              <small>{leaf.closes ? `finishes ${leaf.closes} source${leaf.closes === 1 ? "" : "s"} · ` : ""}{leaf.occurrences} occurrence{leaf.occurrences === 1 ? "" : "s"}</small>
              {leaf.retired_version && <span className="wb-state wb-state-blocked">retired family version</span>}
              {leaf.describer_gaps?.map((gap) => <small key={gap} className="wb-state wb-state-blocked">{gap}</small>)}</header>
            <ul className="wb-surfaces">{leaf.surfaces.map((surface) => {
              const key = `surface:${leaf.fingerprint_id}:${surface.surface}`;
              return <li key={surface.surface}>
                <span className="wb-surface-text">“{surface.sample_text}”</span>
                <small>{surface.closes ? `finishes ${surface.closes} source${surface.closes === 1 ? "" : "s"} · ` : ""}{surface.surface_id ? "decided everywhere" : "not decided"} · {surface.annotations} annotated{surface.pending ? ` · ${surface.pending} pending` : ""} · {surface.sources} source{surface.sources === 1 ? "" : "s"}</small>
                {surface.warnings?.map((warning) => <small key={warning} className="wb-state wb-state-blocked">{warning}</small>)}
                {[key, `apply:${surface.surface_id}`, `move:${surface.surface_id}`, `retire:${surface.surface_id}`].map((queued) => <span key={queued}>{queueNote(queued)}</span>)}
                <span className="wb-actions">
                  {!surface.surface_id && <button className="primary" disabled={waiting(key) || leaf.retired_version} onClick={() => decide(key, surface.sample_text, leaf.family_id, leaf.parameters)}>Decide everywhere</button>}
                  {surface.surface_id && surface.pending > 0 && <button className="primary" disabled={waiting(`apply:${surface.surface_id}`)} onClick={() => apply(surface)}>Apply to {surface.pending} pending</button>}
                  {surface.surface_id && <button className="secondary" onClick={() => setEditing(key)}>Change meaning</button>}
                  {surface.surface_id && <button className="text-button" disabled={waiting(`retire:${surface.surface_id}`)} onClick={() => retire(surface)}>Stop applying</button>}
                </span>
                {editing === key && <LeafForm families={families} exactText={surface.sample_text} role={leaf.role} busy={false} submitLabel="Move this spelling"
                  initial={{ family_id: leaf.family_id, parameters: leaf.parameters }}
                  onSubmit={(familyId, parameters) => move(surface, familyId, parameters)} onCancel={() => setEditing(null)} />}
              </li>;
            })}</ul>
            {group.length > 1 && <div className="wb-actions">
              <select aria-label="Merge into" value={mergeTarget[leaf.fingerprint_id] ?? ""} onChange={(event) => setMergeTarget((current) => ({ ...current, [leaf.fingerprint_id]: event.target.value }))}>
                <option value="">Same meaning as…</option>
                {alphabetical(group.filter((other) => other.fingerprint_id !== leaf.fingerprint_id), (other) => leafLabel(families, other.family_id, other.parameters)).map((other) => <option key={other.fingerprint_id} value={other.fingerprint_id}>{leafLabel(families, other.family_id, other.parameters)}</option>)}
              </select>
              <button className="secondary" disabled={waiting(`merge:${leaf.fingerprint_id}`) || !mergeTarget[leaf.fingerprint_id]} onClick={() => merge(leaf)}>Merge into it</button>
              {queueNote(`merge:${leaf.fingerprint_id}`)}
            </div>}
          </article>)}
        </div>;
      })}
    </section>
  </div>;
}
