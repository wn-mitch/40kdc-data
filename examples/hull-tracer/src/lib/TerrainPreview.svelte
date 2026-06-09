<script lang="ts">
  // Drops the traced model onto a randomly-chosen terrain layout at true scale,
  // so the author can eyeball the footprint against real terrain. View-only:
  // nothing here feeds the export. Terrain geometry comes from the embedded
  // dataset via `diagramModel` (the same derivation the shared LayoutDiagram
  // card uses); the board chrome mirrors LayoutDiagram (portrait 60×44, light
  // tabletop) so it reads like the printed cards. The model sits on top as a
  // draggable, rotatable polygon.
  import { ds } from "./dataset.js";
  import { diagramModel, BOARD, type DiagramModel } from "../../../_shared/layout-geometry.js";
  import { boundsSize, rotatePoint, rotatePoints, toCenteredInches } from "./geometry.js";
  import type { Vec2 } from "./types.js";

  let {
    pixelPoints,
    pxPerInch,
  }: {
    pixelPoints: Vec2[];
    pxPerInch: number | null;
  } = $props();

  // Every embedded terrain layout (raw entities), for the random roll.
  const layouts = ds.terrainLayouts.all;

  function pickRandom(): (typeof layouts)[number] | null {
    if (layouts.length === 0) return null;
    return layouts[Math.floor(Math.random() * layouts.length)];
  }

  let layout = $state(pickRandom());
  let position = $state<Vec2>({ x: BOARD.width / 2, y: BOARD.height / 2 });
  let rotationDeg = $state(0);

  let svgEl = $state<SVGSVGElement | null>(null);
  let gEl = $state<SVGGElement | null>(null);
  let dragging = $state(false);
  let grab: Vec2 = { x: 0, y: 0 };

  const ready = $derived(pxPerInch !== null && pxPerInch > 0 && pixelPoints.length >= 3);

  // Resolve the layout to drawable terrain + zones; a malformed layout must not
  // take the preview down (re-roll past it).
  const diagram = $derived.by<DiagramModel | null>(() => {
    if (!layout) return null;
    try {
      return diagramModel(ds, layout);
    } catch {
      return null;
    }
  });

  // Model outline in board space: pixels→inches (centered on its centroid),
  // rotated, then translated to the current board position.
  const centered = $derived(ready ? toCenteredInches(pixelPoints, pxPerInch!) : []);
  const modelVerts = $derived(
    rotatePoints(centered, rotationDeg).map((v) => ({ x: v.x + position.x, y: v.y + position.y })),
  );
  const modelPts = $derived(modelVerts.map((v) => `${v.x},${v.y}`).join(" "));

  // A short tick from the centroid marks the model's facing so rotation reads.
  const facing = $derived.by(() => {
    const s = boundsSize(centered);
    const reach = Math.max(s.width, s.height) / 2 + 0.6;
    const tip = rotatePoint({ x: 0, y: -reach }, rotationDeg);
    return { x: position.x + tip.x, y: position.y + tip.y };
  });

  const pts = (vs: Vec2[]): string => vs.map((v) => `${v.x},${v.y}`).join(" ");

  function shuffle(): void {
    layout = pickRandom();
  }

  function toBoard(clientX: number, clientY: number): Vec2 {
    const ctm = gEl?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

  function onModelDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    const b = toBoard(e.clientX, e.clientY);
    grab = { x: b.x - position.x, y: b.y - position.y };
    dragging = true;
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent): void {
    if (!dragging) return;
    const b = toBoard(e.clientX, e.clientY);
    // Keep the centroid on the board so the model can't be lost off-edge.
    position = {
      x: clamp(b.x - grab.x, 0, BOARD.width),
      y: clamp(b.y - grab.y, 0, BOARD.height),
    };
  }

  function endDrag(): void {
    dragging = false;
  }
</script>

<div class="preview">
  <div class="bar">
    <button class="shuffle focus-ring" onclick={shuffle} disabled={layouts.length === 0}>
      Shuffle layout
    </button>
    <span class="name" title={layout?.name ?? ""}>
      {layout?.name ?? "No layouts available"}
      {#if diagram}<span class="count">· {diagram.pieces.length} pieces</span>{/if}
    </span>
    <label class="rot">
      Rotate
      <input type="range" min="0" max="359" step="1" bind:value={rotationDeg} class="focus-ring" />
      <span class="deg">{rotationDeg}°</span>
    </label>
  </div>

  {#if !ready}
    <div class="empty">Calibrate a scale and trace at least 3 points to preview the model.</div>
  {:else if !diagram}
    <div class="empty">No terrain layout to show — try Shuffle.</div>
  {:else}
    <svg
      bind:this={svgEl}
      viewBox="0 0 44 60"
      preserveAspectRatio="xMidYMid meet"
      role="application"
      aria-label="Model on a terrain layout, 60 by 44 inch board shown portrait"
      onpointermove={onMove}
      onpointerup={endDrag}
      onpointerleave={endDrag}
    >
      <g bind:this={gEl} transform="translate(44,0) rotate(90)">
        <rect x="0" y="0" width={BOARD.width} height={BOARD.height} class="bg" />

        {#each diagram.zones as z, i (z.player + i)}
          <polygon points={pts(z.points)} class="zone" style:fill={z.color ?? "#14b8a6"} style:stroke={z.color ?? "#14b8a6"} />
        {/each}

        {#each Array(BOARD.width / 5 + 1) as _, i (i)}
          <line x1={i * 5} y1="0" x2={i * 5} y2={BOARD.height} class="grid" />
        {/each}
        {#each Array(Math.floor(BOARD.height / 5) + 1) as _, i (i)}
          <line x1="0" y1={i * 5} x2={BOARD.width} y2={i * 5} class="grid" />
        {/each}

        {#each diagram.pieces as p, i (p.id ?? i)}
          <polygon points={pts(p.vertices)} class="piece {p.piece_type}" />
        {/each}

        <!-- The traced model: draggable, rotatable, with a facing tick. -->
        <line x1={position.x} y1={position.y} x2={facing.x} y2={facing.y} class="facing" />
        <polygon
          points={modelPts}
          class="model"
          class:dragging
          role="button"
          tabindex="-1"
          aria-label="Traced model — drag to reposition"
          onpointerdown={onModelDown}
        />
        <circle cx={position.x} cy={position.y} r="0.35" class="model-pin" />
      </g>
    </svg>
    <p class="hint">Drag the model to test fit. Board is 60″ × 44″; 5″ grid.</p>
  {/if}
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    gap: 8px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .shuffle {
    padding: 6px 14px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel-surface);
    color: var(--color-text-muted);
    font-family: var(--font-heading);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }
  .shuffle:hover:not(:disabled) {
    border-color: var(--color-accent);
    color: var(--color-text);
  }
  .shuffle:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count {
    color: var(--color-text-dim);
  }
  .rot {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-text-dim);
  }
  .rot input {
    width: 120px;
    accent-color: var(--color-accent);
  }
  .deg {
    width: 4ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-muted);
  }
  svg {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: oklch(0.85 0.008 220);
    touch-action: none;
  }
  /* Board chrome — light tabletop, mirroring the shared LayoutDiagram card. */
  .bg {
    fill: oklch(0.85 0.008 220);
  }
  .zone {
    fill-opacity: 0.14;
    stroke-opacity: 0.45;
    stroke-width: 0.18;
  }
  .grid {
    stroke: oklch(0.78 0.01 220);
    stroke-width: 0.07;
  }
  .piece {
    stroke-width: 0.18;
  }
  .piece.area {
    fill: oklch(0.62 0.13 250 / 0.28);
    stroke: oklch(0.62 0.15 250);
  }
  .piece.feature {
    fill: oklch(0.74 0.14 75 / 0.5);
    stroke: oklch(0.74 0.15 75);
  }
  /* The model — a distinct red-orange so it never blends into blue areas,
     amber features, or teal zones. */
  .model {
    fill: oklch(0.62 0.2 25 / 0.55);
    stroke: oklch(0.45 0.2 25);
    stroke-width: 0.22;
    stroke-linejoin: round;
    cursor: grab;
  }
  .model.dragging {
    cursor: grabbing;
    fill: oklch(0.62 0.2 25 / 0.72);
  }
  .facing {
    stroke: oklch(0.45 0.2 25);
    stroke-width: 0.18;
    stroke-linecap: round;
  }
  .model-pin {
    fill: oklch(0.35 0.18 25);
  }
  .empty {
    flex: 1 1 auto;
    display: grid;
    place-items: center;
    padding: 24px;
    text-align: center;
    color: var(--color-text-dim);
    font-size: 13px;
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
  }
  .hint {
    margin: 0;
    font-size: var(--text-2xs, 11px);
    color: var(--color-text-dim);
    font-family: var(--font-mono);
  }
</style>
