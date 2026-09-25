import { useEffect, useState } from "react";

import { api } from "./workbench-api";

type Entry = { entry_id: string; ability_id: string; shape_signature: string; changes: string[] };
type Pending = { factions: Array<{ faction_id: string; entries: Entry[] }>; stale: number; unchanged: number };
type Preview = { batch_id: string; preview_hash: string; faction_id: string; ability_ids: string[]; diff: Array<{ ability_id: string; fields: Array<{ field: string }> }> };
type Receipt = { batch_id: string; ability_ids: string[]; actual_after_hash: string };

/**
 * Publish: write approved compiled entries into a faction's tracked abilities.json. Preparing
 * validates the whole projected dataset without writing; publishing writes exactly those bytes.
 * Nothing is committed to version control here.
 */
export function PublishPage({ revision, busy, perform, setStatus }: {
  revision: number;
  busy: boolean;
  perform: (work: () => Promise<void>) => void;
  setStatus: (text: string) => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [reloads, setReloads] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<Pending>("/publish/pending", undefined, controller.signal)
      .then(setPending).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [revision, reloads]);

  /** Validate each faction's projected file without writing; nothing is written until Write. */
  const prepare = (factions: Pending["factions"]) => perform(async () => {
    const prepared: Preview[] = [];
    for (const faction of factions) {
      prepared.push(await api<Preview>("/publish/prepare", { faction_id: faction.faction_id, entry_ids: faction.entries.map((entry) => entry.entry_id) }));
    }
    setPreviews(prepared);
    setStatus(`${prepared.length} faction file${prepared.length === 1 ? "" : "s"} validated. Review the changes, then write.`);
  });
  const publish = () => perform(async () => {
    let written = 0;
    for (const preview of previews) {
      const receipt = await api<Receipt>("/publish/commit", { batch_id: preview.batch_id, preview_hash: preview.preview_hash });
      written += receipt.ability_ids.length;
    }
    const files = previews.map((preview) => `${preview.faction_id}/abilities.json`).join(", ");
    setPreviews([]);
    setReloads((value) => value + 1);
    setStatus(`Published ${written} abilit${written === 1 ? "y" : "ies"} to ${files}. Review and commit the data change with jj.`);
  });

  if (error) return <p role="alert" className="error">{error}</p>;
  if (!pending) return <p role="status">Checking approved entries…</p>;
  return <div className="wb-publish">
    <p className="wb-progress-strip">{pending.factions.reduce((total, faction) => total + faction.entries.length, 0)} approved entries would change tracked data
      {pending.unchanged ? ` · ${pending.unchanged} already published` : ""}{pending.stale ? ` · ${pending.stale} need re-approval after leaf or source changes` : ""}</p>
    {previews.length > 0 && <section className="wb-wording">
      <h2>Ready to write</h2>
      <ul>{previews.flatMap((preview) => preview.diff.map((item) => <li key={`${preview.faction_id}/${item.ability_id}`}>{preview.faction_id}/{item.ability_id}: {item.fields.map((field) => field.field).join(", ")}</li>))}</ul>
      <div className="wb-actions">
        <button className="primary" disabled={busy} onClick={publish}>Write {previews.reduce((total, preview) => total + preview.ability_ids.length, 0)} entries to {previews.length} file{previews.length === 1 ? "" : "s"}</button>
        <button className="secondary" onClick={() => setPreviews([])}>Cancel</button>
      </div>
    </section>}
    {pending.factions.length > 1 && previews.length === 0 && <div className="wb-actions">
      <button className="primary" disabled={busy} onClick={() => prepare(pending.factions)}>Prepare every faction</button></div>}
    {pending.factions.map((faction) => <section key={faction.faction_id} className="wb-wording">
      <h2>{faction.faction_id} · {faction.entries.length}</h2>
      <ul>{faction.entries.map((entry) => <li key={entry.entry_id}>{entry.ability_id} <small>{entry.shape_signature} · changes {entry.changes.join(", ")}</small></li>)}</ul>
      <div className="wb-actions"><button className="primary" disabled={busy} onClick={() => prepare([faction])}>Prepare {faction.faction_id}</button></div>
    </section>)}
    {!pending.factions.length && <p className="wb-help">Nothing to publish. Approve shapes first.</p>}
  </div>;
}
