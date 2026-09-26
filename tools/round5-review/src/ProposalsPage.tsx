import { useEffect, useState } from "react";

import { LeafForm, leafLabel, type Family } from "./LeafForm";
import { SplitEditor } from "./SplitEditor";
import type { DecisionQueue, QueueItem } from "./decision-queue";
import { api } from "./workbench-api";

type Piece = { text: string; family_id: string; family_version: number; role: string; parameters: Record<string, unknown>; confidence: number; neighbours: Array<{ surface: string; sample_text: string; sim: number }> };
type Unnamed = { text: string; family_id: null };
type Kind = "direct" | "decomposition" | "partial" | "llm" | "new-family" | "unlabelled";
type Proposal = { id: number; surface: string; sample_text: string; kind: Kind; pieces: Array<Piece | Unnamed | NewFamily>; confidence: number; occurrences: number; closes: number; dropped: string[] };
type Cluster = { cluster: number; closes: number; occurrences: number; proposals: Proposal[] };
type Run = { id: number; status: string; model: string; counts: Record<string, number> | null; error: string | null; started_at: string; finished_at: string | null };
type Asking = { clusters: number; started_at: string } | null;
type AskResult = { asked?: number; named?: number; new_families?: number; failed?: string[] } | null;
type Listing = { run: Run | null; latest: Run | null; clusters: Cluster[]; total_clusters: number; running: boolean; asking: Asking; last_ask: AskResult };
type NewFamily = { new_family: { role: string; label: string; distinction: string } };
type ApplyReport = { applied: number; already: number; blocked: unknown[] };

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: "direct", label: "One leaf" },
  { id: "decomposition", label: "Split, all named" },
  { id: "partial", label: "Split, some named" },
  { id: "llm", label: "From the model" },
  { id: "unlabelled", label: "No proposal" },
];
/** Wordings shown per cluster before "show all". */
const CLUSTER_PREVIEW = 8;
/** Groups sent to the model by the "top groups" button. */
const ASK_TOP = 10;
const askSummary = (result: NonNullable<AskResult>) => result.failed?.length && !result.asked
  ? `The model could not be asked: ${result.failed.join("; ")}`
  : `The model named ${result.named ?? 0} of ${result.asked ?? 0} wordings and suggested ${result.new_families ?? 0} new famil${result.new_families === 1 ? "y" : "ies"}${result.failed?.length ? `; ${result.failed.length} call${result.failed.length === 1 ? "" : "s"} failed` : ""}.`;
const named = (piece: Piece | Unnamed | NewFamily): piece is Piece => "family_id" in piece && typeof piece.family_id === "string";
const unnamed = (piece: Piece | Unnamed | NewFamily): piece is Unnamed => "family_id" in piece && piece.family_id === null;
const pieceKey = (text: string) => `piece:${text.toLowerCase()}`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * AI leaf proposals: wording no leaf covers, grouped by mutual-kNN clusters, each with the leaf
 * (or split into leaves) its nearest decided spellings suggest. Accepting sends one decision per
 * named piece through the shared queue; every decision still applies corpus-wide like any other.
 */
export function ProposalsPage({ families, faction, revision, queue, queueItems, reviewer, setStatus }: {
  families: readonly Family[];
  faction: string;
  revision: number;
  queue: DecisionQueue;
  queueItems: readonly QueueItem[];
  reviewer: string;
  setStatus: (text: string) => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Kind[]>(["direct", "decomposition", "partial", "llm"]);
  const [editing, setEditing] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  /** Clusters opened past their first few wordings. */
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  /** Pieces recorded since the listing was last loaded; their wording stays hidden until it reloads. */
  const [settled, setSettled] = useState<ReadonlyMap<string, number>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    const started = Date.now();
    const query = new URLSearchParams({ kinds: kinds.join(",") });
    if (faction) query.set("faction", faction);
    api<Listing>(`/leaf-proposals?${query}`, undefined, controller.signal)
      .then((loaded) => {
        setListing(loaded);
        setError(null);
        setSettled((current) => new Map([...current].filter(([, at]) => at >= started)));
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [faction, revision, reloads, kinds.join(",")]);

  // While a run or the model is going, poll and reload the listing once it ends.
  const working = Boolean(listing?.running || listing?.asking);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      api<{ latest: Run | null; running: boolean; asking: Asking; last_ask: AskResult }>("/leaf-proposals/run")
        .then((state) => {
          if (!state.running && !state.asking) {
            setReloads((value) => value + 1);
            if (state.last_ask) setStatus(askSummary(state.last_ask));
          } else setListing((current) => current ? { ...current, latest: state.latest } : current);
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [working]);

  const state = (key: string) => queueItems.find((item) => item.key === key) ?? null;
  const sent = (key: string) => settled.has(key) || (state(key) !== null && state(key)!.status !== "failed");

  function decide(text: string, familyId: string, parameters: Record<string, unknown>) {
    const key = pieceKey(text);
    queue.enqueue({ key, label: text, path: "/leaves/confirm", body: { reviewer, exact_text: text, family_id: familyId, parameters }, onDone: (value) => {
      const result = value as ApplyReport;
      setSettled((current) => new Map(current).set(key, Date.now()));
      setStatus(`“${text}” decided everywhere: ${result.applied} occurrence${result.applied === 1 ? "" : "s"} annotated${result.blocked.length ? `, ${result.blocked.length} left alone` : ""}.`);
    } });
  }
  const accept = (proposal: Proposal) => {
    setEditing(null);
    for (const piece of proposal.pieces.filter(named)) if (!sent(pieceKey(piece.text))) decide(piece.text, piece.family_id, piece.parameters);
  };
  async function dismiss(proposal: Proposal) {
    try {
      await api("/leaf-proposals/" + proposal.id + "/dismiss", {});
      setListing((current) => current && ({ ...current, clusters: current.clusters.map((cluster) => ({ ...cluster, proposals: cluster.proposals.filter((item) => item.id !== proposal.id) })) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function ask(clusters: number[]) {
    try {
      const started = await api<{ asking: Asking; running: boolean }>("/leaf-proposals/llm", { clusters });
      setListing((current) => current ? { ...current, ...started } : current);
      setStatus(`Asking the model about ${clusters.length} group${clusters.length === 1 ? "" : "s"}; its proposals appear under “From the model” when it answers.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  /** The top groups the nearest-neighbour vote could not name. */
  async function askTop() {
    try {
      const query = new URLSearchParams({ kinds: "unlabelled" });
      if (faction) query.set("faction", faction);
      const unlabelled = await api<Listing>(`/leaf-proposals?${query}`);
      const clusters = unlabelled.clusters.slice(0, ASK_TOP).map((cluster) => cluster.cluster);
      if (clusters.length) await ask(clusters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function run() {
    try {
      const started = await api<{ latest: Run | null; running: boolean }>("/leaf-proposals/run", {});
      setListing((current) => current ? { ...current, ...started } : current);
      setStatus("Proposal run started: embedding the wording and its decided neighbours. The list refreshes when it finishes.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  if (!listing) return error ? <p role="alert" className="error">{error}</p> : <p role="status">Loading proposals…</p>;
  const counts = listing.run?.counts;
  // A proposal whose named pieces are all on their way (or recorded) is hidden.
  const visible = (proposal: Proposal) => !proposal.pieces.filter(named).length || !proposal.pieces.filter(named).every((piece) => sent(pieceKey(piece.text)));

  return <div className="wb-proposals">
    {error && <p role="alert" className="error">{error}</p>}
    <div className="wb-actions">
      <button className="primary" disabled={working} onClick={() => void run()}>{listing.running ? "Running…" : listing.run ? "Run again" : "Run proposals"}</button>
      {listing.run && <button className="secondary" disabled={working} onClick={() => void askTop()}>{listing.asking ? `Asking the model about ${listing.asking.clusters}…` : `Ask the model about the top ${ASK_TOP} unnamed groups`}</button>}
      <small>
        {listing.running && listing.latest?.status === "running" ? `Started ${new Date(listing.latest.started_at).toLocaleTimeString()} · ` : ""}
        {listing.latest?.status === "failed" ? `Last run failed: ${listing.latest.error} · ` : ""}
        {listing.run && counts ? `Run ${listing.run.id}: ${counts.direct} one-leaf, ${counts.decomposition} fully split, ${counts.partial} partly split, ${counts.unlabelled} without a proposal, from ${counts.labelled} decided spellings · ${listing.total_clusters} clusters` : "No proposals yet."}
      </small>
    </div>
    <div className="wb-kind-filter" role="group" aria-label="Proposal kinds">
      {KINDS.map((kind) => <button key={kind.id} className="secondary" aria-pressed={kinds.includes(kind.id)}
        onClick={() => setKinds((current) => current.includes(kind.id) ? current.filter((item) => item !== kind.id) : [...current, kind.id])}>{kind.label}</button>)}
    </div>
    <p className="wb-help">Each group is wording alike enough to be named together; groups that would finish the most sources come first. Accept sends one decision per named piece, and each applies wherever its words appear. Pieces with no proposal resurface on Leaves as their own wording.</p>

    {listing.clusters.map((cluster) => {
      const proposals = cluster.proposals.filter(visible);
      if (!proposals.length) return null;
      const acceptable = proposals.filter((proposal) => proposal.pieces.some(named));
      return <article key={cluster.cluster} className="wb-leaf wb-proposal-cluster">
        <header>
          <strong>{proposals.length} wording{proposals.length === 1 ? "" : "s"}</strong>
          <small>{cluster.closes ? `finishes ${cluster.closes} source${cluster.closes === 1 ? "" : "s"} · ` : ""}appears {cluster.occurrences}×</small>
          {acceptable.length > 1 && <button className="secondary" onClick={() => acceptable.forEach(accept)}>Accept all {acceptable.length}</button>}
          {proposals.some((proposal) => proposal.kind === "unlabelled") && <button className="secondary" disabled={working} onClick={() => void ask([cluster.cluster])}>Ask the model</button>}
        </header>
        <ol className="wb-wording-list">{(expanded.has(cluster.cluster) ? proposals : proposals.slice(0, CLUSTER_PREVIEW)).map((proposal) => <li key={proposal.id} className="wb-wording">
          <div>
            <blockquote>{proposal.sample_text}</blockquote>
            <small>{proposal.closes ? `finishes ${proposal.closes} · ` : ""}appears {proposal.occurrences}× · {KINDS.find((kind) => kind.id === proposal.kind)?.label ?? proposal.kind}{proposal.pieces.some(named) ? ` · ${percent(proposal.confidence)} sure` : ""}</small>
          </div>
          <ul className="wb-proposal-pieces">{proposal.pieces.map((piece, index) => {
            const text = "text" in piece ? piece.text : null;
            const queued = text ? state(pieceKey(text)) : null;
            return <li key={text ?? index}>
              {text && <><span className="wb-surface-text">“{text}”</span>{" "}</>}
              {named(piece)
                ? <><strong>{leafLabel(families, piece.family_id, piece.parameters)}</strong>
                  <small>{piece.confidence === 1 ? "already decided" : piece.neighbours[0] ? `like “${piece.neighbours[0].sample_text}” (${piece.neighbours[0].sim.toFixed(2)})` : "the model’s reading"}</small></>
                : unnamed(piece) ? <small className="wb-needs-leaf">needs a leaf</small>
                  : <small className="wb-needs-leaf">new family? {piece.new_family.role.toLowerCase()} “{piece.new_family.label}”: {piece.new_family.distinction}</small>}
              {queued && <small className={`wb-state ${queued.status === "failed" ? "wb-state-blocked" : "wb-state-queued"}`}>{queued.status === "failed" ? `not recorded: ${queued.error}` : queued.status === "running" ? "recording…" : "queued"}</small>}
            </li>;
          })}</ul>
          {proposal.dropped.length > 0 && <small className="wb-state wb-state-blocked">{proposal.dropped.join("; ")}</small>}
          {editing === `edit:${proposal.id}` || editing === `split:${proposal.id}`
            ? proposal.pieces.filter((piece) => "text" in piece).length > 1 || editing === `split:${proposal.id}`
              ? <SplitEditor text={proposal.sample_text} families={families} busy={false} pieceState={(text) => state(pieceKey(text))}
                initialFor={(text) => { const piece = proposal.pieces.filter(named).find((item) => item.text === text); return piece ? { family_id: piece.family_id, parameters: piece.parameters } : undefined; }}
                onDecide={decide} onCancel={() => setEditing(null)} />
              : <LeafForm families={families} exactText={proposal.sample_text} role={null} busy={false} submitLabel="Decide everywhere"
                initial={proposal.pieces[0] && named(proposal.pieces[0]) ? { family_id: proposal.pieces[0].family_id, parameters: proposal.pieces[0].parameters } : undefined}
                onSubmit={(familyId, parameters) => { setEditing(null); decide(proposal.sample_text, familyId, parameters); }} onCancel={() => setEditing(null)} />
            : <div className="wb-actions">
              {proposal.pieces.some(named) && <button className="primary" onClick={() => accept(proposal)}>Accept{proposal.kind === "partial" ? " named pieces" : ""}</button>}
              <button className="secondary" onClick={() => setEditing(`edit:${proposal.id}`)}>{proposal.pieces.length ? "Edit" : "Name it"}</button>
              {proposal.pieces.length <= 1 && <button className="secondary" onClick={() => setEditing(`split:${proposal.id}`)}>Split into leaves</button>}
              <button className="text-button" onClick={() => void dismiss(proposal)}>Dismiss</button>
            </div>}
        </li>)}</ol>
        {proposals.length > CLUSTER_PREVIEW && !expanded.has(cluster.cluster) && <button className="text-button" onClick={() => setExpanded((current) => new Set(current).add(cluster.cluster))}>
          Show all {proposals.length} wordings</button>}
      </article>;
    })}
    {listing.run && !listing.clusters.length && <p className="wb-help">No open proposals for these kinds.</p>}
  </div>;
}
