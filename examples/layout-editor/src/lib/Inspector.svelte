<script lang="ts">
  import {
    BOARD,
    footprintOf,
    footprintVertices,
    solveCentroid,
    templateById,
    type EditPiece,
    type SolveInput,
  } from "./model.js";

  interface Props {
    piece: EditPiece | null;
    ondelete: (id: string) => void;
  }
  let { piece, ondelete }: Props = $props();

  // The footprint feature options the card might dimension to: each vertex, or
  // an oriented bounding face. Faces are the common "distance to the near edge
  // of the area" case; a vertex is for cards that dimension to a corner.
  type FeatureChoice = { label: string; value: string };
  const xFeatures = $derived<FeatureChoice[]>(featureChoices("x"));
  const yFeatures = $derived<FeatureChoice[]>(featureChoices("y"));

  function featureChoices(axis: "x" | "y"): FeatureChoice[] {
    if (!piece) return [];
    const fp = footprintOf(piece);
    if (!fp) return [];
    const n = footprintVertices(fp as never).length;
    const faces =
      axis === "x"
        ? [
            { label: "left face", value: "face:min-x" },
            { label: "right face", value: "face:max-x" },
          ]
        : [
            { label: "top face", value: "face:min-y" },
            { label: "bottom face", value: "face:max-y" },
          ];
    const verts = Array.from({ length: n }, (_, i) => ({ label: `vertex ${i}`, value: `vertex:${i}` }));
    return [...faces, ...verts];
  }

  // Card-measurement solver form state.
  let xEdge = $state<"left" | "right">("left");
  let xDist = $state<number>(0);
  let xFeature = $state<string>("face:min-x");
  let yEdge = $state<"top" | "bottom">("top");
  let yDist = $state<number>(0);
  let yFeature = $state<string>("face:min-y");
  let solveError = $state<string | null>(null);

  function parseFeature(value: string): SolveInput["lines"][number]["feature"] {
    if (value.startsWith("vertex:")) return { kind: "vertex", index: Number(value.slice(7)) };
    return { kind: "face", side: value.slice(5) as "min-x" | "max-x" | "min-y" | "max-y" };
  }

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
          { edge: xEdge, distance: xDist, feature: parseFeature(xFeature) },
          { edge: yEdge, distance: yDist, feature: parseFeature(yFeature) },
        ],
      });
      piece.position = { x: Math.round(pos.x * 1e4) / 1e4, y: Math.round(pos.y * 1e4) / 1e4 };
    } catch (e) {
      solveError = (e as Error).message;
    }
  }

  const templateName = $derived(piece?.template ? templateById(piece.template)?.name ?? piece.template : "(inline footprint)");
</script>

{#if !piece}
  <p class="empty">Select a piece on the board, or add one from the palette.</p>
{:else}
  <div class="inspector">
    <header>
      <h3>{piece.name ?? piece.id}</h3>
      <button class="danger" onclick={() => ondelete(piece.id)}>Delete</button>
    </header>
    <dl class="meta">
      <dt>id</dt>
      <dd>{piece.id}</dd>
      <dt>type</dt>
      <dd>{piece.piece_type}</dd>
      <dt>template</dt>
      <dd>{templateName}</dd>
    </dl>

    <fieldset>
      <legend>Placement</legend>
      <label>centroid x <input type="number" step="0.05" bind:value={piece.position.x} /></label>
      <label>centroid y <input type="number" step="0.05" bind:value={piece.position.y} /></label>
      <label>rotation° <input type="number" step="1" min="0" max="359" bind:value={piece.rotation_degrees} /></label>
      <label
        >mirror
        <select bind:value={piece.mirror}>
          <option value="none">none</option>
          <option value="horizontal">horizontal</option>
          <option value="vertical">vertical</option>
        </select>
      </label>
      <p class="hint">The centroid is rotation/mirror-invariant — changing orientation never moves it.</p>
    </fieldset>

    <fieldset class="solver">
      <legend>Solve centroid from a reference card</legend>
      <p class="hint">
        Set the rotation &amp; mirror to match the card, then enter the two dimension
        lines it draws. The centroid is back-solved.
      </p>
      <div class="line">
        <select bind:value={xEdge}>
          <option value="left">from left edge</option>
          <option value="right">from right edge</option>
        </select>
        <input type="number" step="0.05" bind:value={xDist} aria-label="x distance" />″ to
        <select bind:value={xFeature}>
          {#each xFeatures as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
        </select>
      </div>
      <div class="line">
        <select bind:value={yEdge}>
          <option value="top">from top edge</option>
          <option value="bottom">from bottom edge</option>
        </select>
        <input type="number" step="0.05" bind:value={yDist} aria-label="y distance" />″ to
        <select bind:value={yFeature}>
          {#each yFeatures as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
        </select>
      </div>
      <button class="primary" onclick={solve}>Solve &amp; place</button>
      {#if solveError}<p class="error">{solveError}</p>{/if}
    </fieldset>
  </div>
{/if}

<style>
  .empty {
    color: #7d8b99;
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
    color: #9fb0c0;
    margin: 0.4rem 0 0.8rem;
  }
  .meta dt {
    color: #6b7e8c;
    font-family: "JetBrains Mono", monospace;
  }
  .meta dd {
    margin: 0;
  }
  fieldset {
    border: 1px solid #243140;
    border-radius: 6px;
    margin: 0 0 0.8rem;
    padding: 0.6rem 0.75rem 0.75rem;
  }
  legend {
    font-family: "Barlow Condensed", sans-serif;
    font-size: 0.95rem;
    color: #c8d4e0;
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
    background: #0b0f14;
    color: #e6edf3;
    border: 1px solid #2a3a4a;
    border-radius: 4px;
    padding: 0.2rem 0.35rem;
    font: inherit;
    font-size: 0.82rem;
  }
  input[type="number"] {
    width: 5rem;
  }
  .hint {
    font-size: 0.74rem;
    color: #7d8b99;
    margin: 0.3rem 0 0;
  }
  .solver .line {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.45rem;
    font-size: 0.8rem;
    flex-wrap: wrap;
  }
  button {
    font: inherit;
    border-radius: 4px;
    border: 1px solid #2a3a4a;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    background: #182230;
    color: #e6edf3;
  }
  button.primary {
    background: #2563c0;
    border-color: #2563c0;
  }
  button.danger {
    background: transparent;
    border-color: #5a2a2a;
    color: #e0a0a0;
    font-size: 0.78rem;
    padding: 0.15rem 0.5rem;
  }
  .error {
    color: #e0a0a0;
    font-size: 0.78rem;
    margin: 0.4rem 0 0;
  }
</style>
