import { useEffect, useState } from "react";

import { RoundTripView } from "./RoundTripView";
import { api } from "./workbench-api";

type ReadyItem = {
  ability_version_id: number; faction_id: string; ability_id: string; name: string | null;
  source_hash: string; source_text: string; review_evidence_hash: string;
};
type QueuedItem = ReadyItem & { escalation_id: string; in_flight_run_id: number | null };
type Queue = { ready: ReadyItem[]; queued: QueuedItem[]; ready_total: number; queued_total: number };
type PreparedPacket = { run_id: string; status: string; request: { items: Array<{ item_id: string }> } };

/** How many composition gaps one prepared packet may carry; the 48 KiB cap may take fewer. */
const PACKET_LIMIT = 15;

/**
 * Fully reviewed sources in two blocks: those awaiting the whole-context check, and checked
 * sources queued for composition. Both act on a selected block at once; proposals run in the
 * background and never approve anything.
 */
export function CompositionQueuePanel({ faction, busy, perform, reviewer, revision, openAbility, openStamp, onRunsStarted, setStatus }: {
  faction: string;
  busy: boolean;
  perform: (work: () => Promise<void>, expectsRevision?: boolean) => void;
  reviewer: string;
  revision: number;
  openAbility: (id: number) => void;
  openStamp: (stampId: string, revision: number) => void;
  onRunsStarted: (runIds: string[]) => void;
  setStatus: (text: string) => void;
}) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [checkSelection, setCheckSelection] = useState<Set<number>>(new Set());
  const [composeSelection, setComposeSelection] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    api<Queue>(`/composition-queue${faction ? `?faction=${encodeURIComponent(faction)}` : ""}`, undefined, controller.signal)
      .then((result) => {
        setQueue(result);
        setCheckSelection((current) => new Set([...current].filter((id) => result.ready.some((item) => item.ability_version_id === id))));
        setComposeSelection((current) => new Set([...current].filter((id) => result.queued.some((item) => item.escalation_id === id))));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [faction, revision]);

  function toggle<T>(set: Set<T>, value: T, checked: boolean): Set<T> {
    const next = new Set(set);
    if (checked) next.add(value); else next.delete(value);
    return next;
  }

  function checkSelected() {
    if (!queue) return;
    const items = queue.ready.filter((item) => checkSelection.has(item.ability_version_id));
    perform(async () => {
      const result = await api<{ checked: number }>("/abilities/review-batch", {
        reviewer,
        items: items.map((item) => ({ ability_version_id: item.ability_version_id, source_hash: item.source_hash, expected_review_hash: item.review_evidence_hash })),
      });
      setCheckSelection(new Set());
      setStatus(`Recorded ${result.checked} whole-context checks. They are queued for composition below.`);
    });
  }

  /** Prepare as many packets as the selection needs, start each in the background, and return. */
  function composeSelected() {
    const remaining = [...composeSelection];
    perform(async () => {
      const started: string[] = [];
      while (remaining.length > 0) {
        const block = remaining.slice(0, PACKET_LIMIT);
        const prepared = await api<PreparedPacket>("/work/prepare", { purpose: "propose-rule", ids: block, limit: block.length });
        const included = new Set(prepared.request.items.map((item) => item.item_id));
        if (included.size === 0) throw new Error("A composition packet came back empty; nothing was started.");
        for (const id of included) remaining.splice(remaining.indexOf(id), 1);
        if (prepared.status === "pending") {
          await api("/work/run", { run_id: prepared.run_id });
          started.push(prepared.run_id);
        }
      }
      setComposeSelection(new Set());
      onRunsStarted(started);
      setStatus(`Started ${started.length} composition run${started.length === 1 ? "" : "s"} in the background. Proposed rules appear in Stamps as each finishes; nothing is approved automatically.`);
    });
  }

  if (!queue) return <p role="status">Loading the composition queue…</p>;
  const idleQueued = queue.queued;
  return <div className="wb-composition-queue">
    <section className="wb-work-step">
      <h2>1. Whole-context check · {queue.ready_total}</h2>
      <p className="wb-help">Every meaningful byte of these sources is reviewed and nothing is pending. Read each complete source, select the ones you have checked, and record them together.</p>
      <div className="wb-actions">
        <label className="wb-check"><input type="checkbox" checked={queue.ready.length > 0 && checkSelection.size === queue.ready.length}
          onChange={(event) => setCheckSelection(new Set(event.target.checked ? queue.ready.map((item) => item.ability_version_id) : []))} /><span>Select all {queue.ready.length}</span></label>
        <button className="primary" disabled={busy || checkSelection.size === 0} onClick={checkSelected}>Check whole source for {checkSelection.size} selected</button>
      </div>
      {queue.ready.map((item) => <article key={item.ability_version_id} className="wb-atom">
        <label className="wb-check"><input type="checkbox" checked={checkSelection.has(item.ability_version_id)} onChange={(event) => setCheckSelection((current) => toggle(current, item.ability_version_id, event.target.checked))} />
          <span><strong>{item.name ?? item.ability_id}</strong> <small>{item.faction_id}/{item.ability_id}</small></span></label>
        <blockquote>{item.source_text}</blockquote>
        <details><summary>Round trip</summary><RoundTripView abilityVersionId={item.ability_version_id} revision={revision} openStamp={openStamp} /></details>
        <button className="text-button" onClick={() => openAbility(item.ability_version_id)}>Inspect spans</button>
      </article>)}
      {!queue.ready.length && <p className="wb-help">No fully reviewed source is waiting for its check.</p>}
    </section>

    <section className="wb-work-step">
      <h2>2. Queued for composition · {queue.queued_total}</h2>
      <p className="wb-help">Checked sources with an open composition gap. Fire a block to generate one source-bound composition proposal per source; each still needs a challenge, your approval, and verification.</p>
      <div className="wb-actions">
        <label className="wb-check"><input type="checkbox" checked={idleQueued.length > 0 && composeSelection.size === idleQueued.length}
          onChange={(event) => setComposeSelection(new Set(event.target.checked ? idleQueued.map((item) => item.escalation_id) : []))} /><span>Select all {idleQueued.length}</span></label>
        <button className="primary" disabled={busy || composeSelection.size === 0} onClick={composeSelected}>Generate composition proposals for {composeSelection.size} selected</button>
      </div>
      {queue.queued.map((item) => <article key={item.escalation_id} className="wb-atom">
        <label className="wb-check"><input type="checkbox" checked={composeSelection.has(item.escalation_id)}
          onChange={(event) => setComposeSelection((current) => toggle(current, item.escalation_id, event.target.checked))} />
          <span><strong>{item.name ?? item.ability_id}</strong> <small>{item.faction_id}/{item.ability_id}{item.in_flight_run_id !== null ? ` · prepared in pending run ${item.in_flight_run_id}; firing again reuses or re-runs it` : ""}</small></span></label>
        <blockquote>{item.source_text}</blockquote>
        <details open><summary>Round trip</summary><RoundTripView abilityVersionId={item.ability_version_id} revision={revision} openStamp={openStamp} /></details>
      </article>)}
      {!queue.queued.length && <p className="wb-help">Nothing is queued. Check fully reviewed sources above to queue them.</p>}
    </section>
  </div>;
}
