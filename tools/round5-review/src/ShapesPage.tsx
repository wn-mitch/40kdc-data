import { useEffect, useState } from "react";

import { api } from "./workbench-api";

type Summary = { signature: string; members: number; distinct_sources: number; compiles: number; approved: number; open: number; first_error: string | null };
type Member = {
  ability_version_ids: number[];
  abilities: Array<{ ability_version_id: number; faction_id: string; ability_id: string; name: string | null }>;
  source_text: string; authored_text: string | null; compiled_text: string | null; differs: boolean;
  state: "approved" | "rejected" | "stale" | "open"; errors: string[];
};

const STATE_LABELS: Record<Member["state"], string> = { approved: "approved", rejected: "rejected", stale: "approved for older leaves", open: "not reviewed" };

/**
 * Shapes: sources every leaf describes, grouped by how their leaves combine. Each member shows
 * the source, what is authored today, and what the compiler produces; approving records the
 * compiled entry for every selected member.
 */
export function ShapesPage({ faction, revision, busy, perform, reviewer, onBatch, openAbility, setStatus }: {
  faction: string;
  revision: number;
  busy: boolean;
  perform: (work: () => Promise<void>) => void;
  reviewer: string;
  onBatch: (batchId: string) => void;
  openAbility: (id: number) => void;
  setStatus: (text: string) => void;
}) {
  const [shapes, setShapes] = useState<{ shapes: Summary[]; tiled: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reloads, setReloads] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const query = faction ? `faction=${encodeURIComponent(faction)}` : "";

  useEffect(() => {
    const controller = new AbortController();
    api<{ shapes: Summary[]; tiled: number }>(`/shapes${query ? `?${query}` : ""}`, undefined, controller.signal)
      .then(setShapes).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [query, revision, reloads]);

  useEffect(() => {
    if (!open) { setMembers(null); return; }
    const controller = new AbortController();
    api<{ members: Member[] }>(`/shapes/members?signature=${encodeURIComponent(open)}${query ? `&${query}` : ""}`, undefined, controller.signal)
      .then((result) => {
        setMembers(result.members);
        // Preselect everything that compiles cleanly and still needs a decision.
        setSelected(new Set(result.members.filter((member) => !member.errors.length && (member.state === "open" || member.state === "stale")).flatMap((member) => member.ability_version_ids)));
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [open, query, revision, reloads]);

  const decide = (action: "approve" | "reject") => perform(async () => {
    if (!open) return;
    const result = await api<{ batch_id: string; recorded: number }>(`/shapes/${action}`, { reviewer, signature: open, ability_version_ids: [...selected] });
    onBatch(result.batch_id);
    setReloads((value) => value + 1);
    setStatus(`${action === "approve" ? "Approved" : "Rejected"} ${result.recorded} compiled entr${result.recorded === 1 ? "y" : "ies"}. ${action === "approve" ? "Publish them from Publish." : ""} Undo reverses it.`);
  });
  const toggle = (member: Member, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    for (const id of member.ability_version_ids) { if (checked) next.add(id); else next.delete(id); }
    return next;
  });

  if (error) return <p role="alert" className="error">{error}</p>;
  if (!shapes) return <p role="status">Grouping fully described sources…</p>;
  return <div className="wb-shapes">
    <p className="wb-progress-strip"><strong>{shapes.tiled}</strong> fully described sources in {shapes.shapes.length} shape{shapes.shapes.length === 1 ? "" : "s"}. Name more leaves to add sources here.</p>
    <ol className="wb-wording-list">{shapes.shapes.map((shape) => <li key={shape.signature} className="wb-wording">
      <div><strong>{shape.signature}</strong>
        <small>{shape.members} sources ({shape.distinct_sources} distinct texts) · {shape.compiles} compile · {shape.approved} approved · {shape.open} to review</small>
        {shape.first_error && <small className="error">{shape.first_error}</small>}</div>
      <div className="wb-actions"><button className={open === shape.signature ? "secondary" : "primary"} onClick={() => setOpen(open === shape.signature ? null : shape.signature)}>
        {open === shape.signature ? "Close" : "Review members"}</button></div>
      {open === shape.signature && (members ? <div className="wb-shape-members">
        <div className="wb-actions">
          <button className="primary" disabled={busy || selected.size === 0} onClick={() => decide("approve")}>Approve {selected.size} selected</button>
          <button className="secondary danger" disabled={busy || selected.size === 0} onClick={() => decide("reject")}>Reject selected</button>
        </div>
        <table className="wb-shape-table"><thead><tr><th /><th>Source</th><th>Authored today</th><th>Compiled</th></tr></thead>
          <tbody>{members.map((member) => <tr key={member.ability_version_ids.join(",")} className={member.differs ? "wb-differs" : ""}>
            <td><input type="checkbox" aria-label="Select member" disabled={member.errors.length > 0} checked={member.ability_version_ids.every((id) => selected.has(id))}
              onChange={(event) => toggle(member, event.target.checked)} /></td>
            <td><blockquote>{member.source_text}</blockquote>
              <small>{member.abilities.map((ability) => `${ability.faction_id}/${ability.ability_id}`).join(", ")} · {STATE_LABELS[member.state]}</small>
              <button className="text-button" onClick={() => openAbility(member.ability_version_ids[0]!)}>Open source</button></td>
            <td>{member.authored_text ?? <span className="wb-muted">No authored entry</span>}</td>
            <td>{member.compiled_text ?? <span className="wb-muted">Does not render</span>}{member.differs && !member.errors.length && <small> · changes the authored entry</small>}
              {member.errors.map((message) => <p key={message} className="error">{message}</p>)}</td>
          </tr>)}</tbody></table>
      </div> : <p role="status">Compiling members…</p>)}
    </li>)}</ol>
  </div>;
}
