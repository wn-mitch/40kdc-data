<script lang="ts">
  import {
    BOARD,
    footprintOf,
    footprintVertices,
    solveCentroid,
    templateById,
    type EditPiece,
    type Mirror,
    type SolverRef,
    type SolverLine,
  } from "./model.js";

  interface Props {
    piece: EditPiece | null;
    ondelete: (id: string) => void;
    onmove: (id: string, position: { x: number; y: number }) => void;
    onorient: (id: string, patch: { rotation_degrees?: number; mirror?: Mirror }) => void;
    onlinkgroup: (id: string, group: string | undefined) => void;
    onsolverhover: (ref: SolverRef | null) => void;
    onsolverlines: (lines: SolverLine[]) => void;
  }
  let { piece, ondelete, onmove, onorient, onlinkgroup, onsolverhover, onsolverlines }: Props =
    $props();

  type FeatureChoice = { label: string; ref: SolverRef };
  function featureChoices(axis: "x" | "y"): FeatureChoice[] {
    if (!piece) return [];
    const fp = footprintOf(piece);
    if (!fp) return [];
    const n = footprintVertices(fp as never).length;
    const faces: FeatureChoice[] =
      axis === "x"
        ? [
            { label: "left face", ref: { kind: "face", side: "min-x" } },
            { label: "right face", ref: { kind: "face", side: "max-x" } },
          ]
        : [
            { label: "top face", ref: { kind: "face", side: "min-y" } },
            { label: "bottom face", ref: { kind: "face", side: "max-y" } },
          ];
    const verts: FeatureChoice[] = Array.from({ length: n }, (_, i) => ({
      label: `v${i}`,
      ref: { kind: "vertex", index: i },
    }));
    return [...faces, ...verts];
  }
  const xFeatures = $derived(featureChoices("x"));
  const yFeatures = $derived(featureChoices("y"));

  // Solver form state.
  let xEdge = $state<"left" | "right">("left");
  let xDist = $state<number>(0);
  let xRef = $state<SolverRef>({ kind: "face", side: "min-x" });
  let yEdge = $state<"top" | "bottom">("top");
  let yDist = $state<number>(0);
  let yRef = $state<SolverRef>({ kind: "face", side: "min-y" });
  let solveError = $state<string | null>(null);

  const sameRef = (a: SolverRef, b: SolverRef): boolean =>
    a.kind === "vertex" && b.kind === "vertex"
      ? a.index === b.index
      : a.kind === "face" && b.kind === "face"
        ? a.side === b.side
        : false;

  // Push the current dimension lines to the board so the guides track live.
  $effect(() => {
    onsolverlines([
      { edge: xEdge, distance: xDist, ref: xRef },
      { edge: yEdge, distance: yDist, ref: yRef },
    ]);
  });

  function solve(): void {
    solveError = null;
    if (!piece) return;
    const fp = footprintOf(piece);
    if (!fp) {
      solveError = "piece has no footprint to solve against";
      return;
    }
    try {
      const pos = solveCentroid({
        footprint: fp as never,
        rotation: piece.rotation_degrees,
        mirror: piece.mirror,
        board: { width: BOARD.width, height: BOARD.height },
        lines: [
          { edge: xEdge, distance: xDist, feature: xRef },
          { edge: yEdge, distance: yDist, feature: yRef },
        ],
      });
      onmove(piece.id, { x: Math.round(pos.x * 1e4) / 1e4, y: Math.round(pos.y * 1e4) / 1e4 });
    } catch (e) {
      solveError = (e as Error).message;
    }
  }

  const templateName = $derived(
    piece?.template ? templateById(piece.template)?.name ?? piece.template : "(inline footprint)",
  );
  const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);
</script>

{#if !piece}
  <p class="empty">Select a piece on the board, or add one from the palette.</p>
{:else}
  <div class="inspector">
    <header>
      <h3>{piece.name ?? piece.id}</h3>
      <button class="danger" onclick={() => ondelete(piece.id)}>Delete pair</button>
    </header>
    <dl class="meta">
      <dt>id</dt>
      <dd>{piece.id}</dd>
      <dt>type</dt>
      <dd>{piece.piece_type}</dd>
      <dt>template</dt>
      <dd>{templateName}</dd>
      <dt>twin</dt>
      <dd>{piece.twin_id ?? "— (independent)"}</dd>
    </dl>

    <fieldset>
      <legend>Placement</legend>
      <label
        >centroid x
        <input type="number" step="0.05" value={piece.position.x} oninput={(e) => onmove(piece.id, { x: num(e), y: piece.position.y })} /></label
      >
      <label
        >centroid y
        <input type="number" step="0.05" value={piece.position.y} oninput={(e) => onmove(piece.id, { x: piece.position.x, y: num(e) })} /></label
      >
      <label
        >rotation°
        <input type="number" step="1" min="0" max="359" value={piece.rotation_degrees} oninput={(e) => onorient(piece.id, { rotation_degrees: num(e) })} /></label
      >
      <label
        >mirror
        <select value={piece.mirror} onchange={(e) => onorient(piece.id, { mirror: (e.currentTarget as HTMLSelectElement).value as Mirror })}>
          <option value="none">none</option>
          <option value="horizontal">horizontal</option>
          <option value="vertical">vertical</option>
        </select>
      </label>
      <label
        >link group
        <input type="text" placeholder="(none)" value={piece.link_group ?? ""} oninput={(e) => onlinkgroup(piece.id, (e.currentTarget as HTMLInputElement).value)} /></label
      >
      <p class="hint">
        The centroid is rotation/mirror-invariant. Edits carry the 180° twin along;
        the link group is mirrored onto it too.
      </p>
    </fieldset>

    <fieldset class="solver">
      <legend>Solve centroid from a reference card</legend>
      <p class="hint">
        Set rotation &amp; mirror to match the card, then enter the two dimension lines.
        Hover a face/corner to see it on the board; the guide shows which edge it measures from.
      </p>

      <div class="line">
        <select value={xEdge} onchange={(e) => (xEdge = (e.currentTarget as HTMLSelectElement).value as "left" | "right")}>
          <option value="left">from left edge</option>
          <option value="right">from right edge</option>
        </select>
        <input type="number" step="0.05" value={xDist} oninput={(e) => (xDist = num(e))} aria-label="x distance" />″ to
      </div>
      <div class="features">
        {#each xFeatures as f (f.label)}
          <button
            class="feat {sameRef(xRef, f.ref) ? 'on' : ''}"
            onpointerenter={() => onsolverhover(f.ref)}
            onpointerleave={() => onsolverhover(null)}
            onclick={() => (xRef = f.ref)}>{f.label}</button
          >
        {/each}
      </div>

      <div class="line">
        <select value={yEdge} onchange={(e) => (yEdge = (e.currentTarget as HTMLSelectElement).value as "top" | "bottom")}>
          <option value="top">from top edge</option>
          <option value="bottom">from bottom edge</option>
        </select>
        <input type="number" step="0.05" value={yDist} oninput={(e) => (yDist = num(e))} aria-label="y distance" />″ to
      </div>
      <div class="features">
        {#each yFeatures as f (f.label)}
          <button
            class="feat {sameRef(yRef, f.ref) ? 'on' : ''}"
            onpointerenter={() => onsolverhover(f.ref)}
            onpointerleave={() => onsolverhover(null)}
            onclick={() => (yRef = f.ref)}>{f.label}</button
          >
        {/each}
      </div>

      <button class="primary" onclick={solve}>Solve &amp; place</button>
      {#if solveError}<p class="error">{solveError}</p>{/if}
    </fieldset>
  </div>
{/if}

<style>
  .empty {
    color: var(--text-mute);
    font-size: 0.9rem;
  }
  .inspector header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  h3 {
    margin: 0;
    font-family: "Barlow Condensed", sans-serif;
    font-size: 1.3rem;
  }
  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.1rem 0.75rem;
    font-size: 0.82rem;
    color: var(--text-dim);
    margin: 0.4rem 0 0.8rem;
  }
  .meta dt {
    color: var(--text-mute);
    font-family: "JetBrains Mono", monospace;
  }
  .meta dd {
    margin: 0;
  }
  fieldset {
    border: 1px solid var(--rim);
    border-radius: 6px;
    margin: 0 0 0.8rem;
    padding: 0.6rem 0.75rem 0.75rem;
  }
  legend {
    font-family: "Barlow Condensed", sans-serif;
    font-size: 0.95rem;
    color: var(--text);
    padding: 0 0.4rem;
  }
  label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    margin-bottom: 0.35rem;
  }
  input,
  select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--rim);
    border-radius: 4px;
    padding: 0.2rem 0.35rem;
    font: inherit;
    font-size: 0.82rem;
  }
  input[type="number"] {
    width: 5rem;
  }
  input[type="text"] {
    width: 8rem;
  }
  .hint {
    font-size: 0.74rem;
    color: var(--text-mute);
    margin: 0.3rem 0 0;
  }
  .solver .line {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.3rem;
    font-size: 0.8rem;
    flex-wrap: wrap;
  }
  .features {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }
  .feat {
    font: inherit;
    font-size: 0.72rem;
    background: var(--surface-2);
    color: var(--text-dim);
    border: 1px solid var(--rim);
    border-radius: 4px;
    padding: 0.12rem 0.4rem;
    cursor: pointer;
  }
  .feat.on {
    border-color: var(--accent);
    background: var(--accent-fill);
    color: var(--accent-strong);
  }
  button {
    font: inherit;
    border-radius: 4px;
    border: 1px solid var(--rim);
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    background: var(--surface-2);
    color: var(--text);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }
  button.danger {
    background: transparent;
    border-color: var(--danger-rim);
    color: var(--danger);
    font-size: 0.78rem;
    padding: 0.15rem 0.5rem;
  }
  .error {
    color: var(--danger);
    font-size: 0.78rem;
    margin: 0.4rem 0 0;
  }
</style>
