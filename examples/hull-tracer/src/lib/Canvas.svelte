<script lang="ts">
  import {
    boundingBox,
    distance,
    displayScale,
    polygonCentroid,
    screenToUserRadius,
  } from "./geometry.js";
  import type { Vec2 } from "./types.js";

  // The single interactive surface. The SVG user-space is the image's natural
  // pixel grid (viewBox 0 0 w h), with the bitmap drawn 1:1 beneath. Pointer
  // events are mapped back through the content group's screen-CTM inverse — the
  // same matrix trick the layout-editor board uses — so a click anywhere, at any
  // display scale, lands on the correct image pixel.
  //
  // Two overlays share this surface, gated by `mode`:
  //   • scale — a two-point ruler (drag either endpoint, or the line to move
  //             both) used to calibrate pixels→inches.
  //   • trace — the hull polygon (click to drop vertices, click the first to
  //             close, drag to adjust, right-click to remove).
  // Handles are sized in *screen* pixels (constant on-screen, independent of the
  // photo's resolution) by measuring the live display scale.
  let {
    imageUrl,
    imageWidth,
    imageHeight,
    mode,
    showRuler,
    points = $bindable(),
    closed = $bindable(),
    selectedIndex = $bindable(),
    rulerA = $bindable(),
    rulerB = $bindable(),
  }: {
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    // "preview" never reaches this component (App swaps in TerrainPreview), but
    // the prop accepts the full mode union so the binding type-checks.
    mode: "scale" | "trace" | "preview";
    showRuler: boolean;
    points: Vec2[];
    closed: boolean;
    selectedIndex: number | null;
    rulerA: Vec2;
    rulerB: Vec2;
  } = $props();

  // On-screen handle/stroke targets (CSS px). Strokes use `non-scaling-stroke`
  // so they are already in screen px; circle radii are user-space and must be
  // divided by the display scale to hold a constant on-screen size.
  const VERTEX_R_PX = 5;
  const FIRST_R_PX = 6.5;
  const RULER_R_PX = 7;
  const STROKE_PX = 1.5;
  const SNAP_PX = 16;
  const LABEL_PX = 11;

  let svgEl = $state<SVGSVGElement | null>(null);
  let gEl = $state<SVGGElement | null>(null);

  // Live on-screen scale of the fitted image, kept current by a ResizeObserver.
  let scale = $state(1);
  $effect(() => {
    const el = svgEl;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      scale = displayScale(r.width, r.height, imageWidth, imageHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const handleR = $derived(screenToUserRadius(VERTEX_R_PX, scale));
  const firstR = $derived(screenToUserRadius(FIRST_R_PX, scale));
  const rulerR = $derived(screenToUserRadius(RULER_R_PX, scale));
  const snap = $derived(screenToUserRadius(SNAP_PX, scale));
  const labelSize = $derived(screenToUserRadius(LABEL_PX, scale));
  const labelGap = $derived(screenToUserRadius(LABEL_PX, scale));

  const isTrace = $derived(mode === "trace");
  const isScale = $derived(mode === "scale");
  const canClose = $derived(isTrace && !closed && points.length >= 3);

  const centroid = $derived(points.length >= 3 ? polygonCentroid(points) : null);
  const bbox = $derived(boundingBox(points));
  const polyAttr = $derived(points.map((p) => `${p.x},${p.y}`).join(" "));

  // One drag at a time across both overlays.
  type Drag =
    | { kind: "vertex"; index: number }
    | { kind: "rulerA" }
    | { kind: "rulerB" }
    | { kind: "rulerLine"; grab: Vec2; a0: Vec2; b0: Vec2 }
    | null;
  let drag = $state<Drag>(null);

  function toImage(clientX: number, clientY: number): Vec2 {
    const ctm = gEl?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function capture(e: PointerEvent): void {
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  // ── Trace overlay ──────────────────────────────────────────────────────────
  function onBackgroundDown(e: PointerEvent): void {
    if (e.button !== 0 || !isTrace) return;
    const p = toImage(e.clientX, e.clientY);
    if (closed) {
      selectedIndex = null;
      return;
    }
    // Snap-close: clicking near the first vertex with a real polygon closes it.
    if (points.length >= 3 && distance(p, points[0]) <= snap) {
      closeRing();
      return;
    }
    points = [...points, p];
    selectedIndex = points.length - 1;
  }

  function onVertexDown(e: PointerEvent, index: number): void {
    if (e.button !== 0 || !isTrace) return;
    e.stopPropagation();
    // Clicking the first vertex of an open ≥3-gon closes it — this is the path
    // the on-canvas hint promises. (A bare circle would otherwise just start a
    // drag and the ring could never be closed by clicking the dot.)
    if (index === 0 && !closed && points.length >= 3) {
      closeRing();
      return;
    }
    selectedIndex = index;
    drag = { kind: "vertex", index };
    capture(e);
  }

  function onVertexContext(e: MouseEvent, index: number): void {
    if (!isTrace) return;
    e.preventDefault();
    e.stopPropagation();
    deleteVertex(index);
  }

  function closeRing(): void {
    if (points.length >= 3) closed = true;
  }

  export function deleteVertex(index: number): void {
    if (index < 0 || index >= points.length) return;
    points = points.filter((_, i) => i !== index);
    selectedIndex = null;
    if (points.length < 3) closed = false;
  }

  // ── Ruler overlay ────────────────────────────────────────────────────────────
  function onRulerEndDown(e: PointerEvent, which: "rulerA" | "rulerB"): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag = { kind: which };
    capture(e);
  }

  function onRulerLineDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag = { kind: "rulerLine", grab: toImage(e.clientX, e.clientY), a0: rulerA, b0: rulerB };
    capture(e);
  }

  // ── Shared pointer move / up ──────────────────────────────────────────────────
  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    const p = toImage(e.clientX, e.clientY);
    switch (drag.kind) {
      case "vertex": {
        const next = points.slice();
        next[drag.index] = p;
        points = next;
        break;
      }
      case "rulerA":
        rulerA = p;
        break;
      case "rulerB":
        rulerB = p;
        break;
      case "rulerLine": {
        const dx = p.x - drag.grab.x;
        const dy = p.y - drag.grab.y;
        rulerA = { x: drag.a0.x + dx, y: drag.a0.y + dy };
        rulerB = { x: drag.b0.x + dx, y: drag.b0.y + dy };
        break;
      }
    }
  }

  function endDrag(): void {
    drag = null;
  }
</script>

<div class="canvas-wrap">
  <svg
    bind:this={svgEl}
    viewBox="0 0 {imageWidth} {imageHeight}"
    preserveAspectRatio="xMidYMid meet"
    class:scale-mode={isScale}
    class:trace-mode={isTrace}
    role="application"
    aria-label={isScale ? "Scale calibration canvas" : "Hull tracing canvas"}
    onpointerdown={onBackgroundDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointerleave={endDrag}
  >
    <g bind:this={gEl}>
      <image href={imageUrl} x="0" y="0" width={imageWidth} height={imageHeight} />

      <!-- Hull polygon. Always shown so progress is visible, but dimmed and
           non-interactive outside trace mode. -->
      {#if points.length >= 2}
        <polygon
          points={polyAttr}
          class="hull"
          class:open={!closed}
          class:idle={!isTrace}
          style="stroke-width:{STROKE_PX}"
        />
      {/if}

      {#if centroid}
        <circle cx={centroid.x} cy={centroid.y} r={handleR * 0.55} class="centroid" />
      {/if}

      {#if isTrace}
        {#each points as p, i (i)}
          {#if i === 0 && !closed}
            <!-- The start vertex: a haloed, labelled, accent-filled marker so it
                 is unmistakable, and a generous click target to close the ring. -->
            <circle
              cx={p.x}
              cy={p.y}
              r={firstR * 2}
              class="first-halo"
              class:armed={canClose}
              style="stroke-width:{STROKE_PX}"
              pointer-events="none"
            />
          {/if}
          <circle
            cx={p.x}
            cy={p.y}
            r={i === 0 && !closed ? firstR : handleR}
            class="vertex"
            class:first={i === 0 && !closed}
            class:selected={i === selectedIndex}
            style="stroke-width:{STROKE_PX}"
            role="button"
            tabindex="-1"
            aria-label={i === 0 ? "Vertex 1 (start)" : `Vertex ${i + 1}`}
            onpointerdown={(e) => onVertexDown(e, i)}
            oncontextmenu={(e) => onVertexContext(e, i)}
          />
          {#if i === 0 && !closed}
            <text
              x={p.x}
              y={p.y}
              class="vertex-label"
              style="font-size:{labelSize}px"
              pointer-events="none">1</text
            >
          {/if}
        {/each}
      {/if}

      <!-- Two-point ruler. Interactive only while calibrating by ruler. -->
      {#if isScale && showRuler}
        <line
          x1={rulerA.x}
          y1={rulerA.y}
          x2={rulerB.x}
          y2={rulerB.y}
          class="ruler-line"
          style="stroke-width:{STROKE_PX}"
          role="button"
          tabindex="-1"
          aria-label="Move ruler"
          onpointerdown={onRulerLineDown}
        />
        {#each [["rulerA", rulerA, "A"], ["rulerB", rulerB, "B"]] as [key, pt, label] (key)}
          <circle
            cx={(pt as Vec2).x}
            cy={(pt as Vec2).y}
            r={rulerR}
            class="ruler-end"
            style="stroke-width:{STROKE_PX}"
            role="button"
            tabindex="-1"
            aria-label={`Ruler ${label}`}
            onpointerdown={(e) => onRulerEndDown(e, key as "rulerA" | "rulerB")}
          />
          <text
            x={(pt as Vec2).x}
            y={(pt as Vec2).y - rulerR - labelGap * 0.4}
            class="ruler-label"
            style="font-size:{labelSize}px"
            pointer-events="none">{label}</text
          >
        {/each}
      {/if}
    </g>
  </svg>

  <div class="hint" aria-live="polite">
    {#if isScale}
      {#if showRuler}
        Drag endpoint A or B — or the line — across a feature of known length.
      {:else}
        Enter the image's real width in the panel.
      {/if}
    {:else if closed}
      {points.length} points · closed · right-click a point to remove
    {:else}
      {points.length} point{points.length === 1 ? "" : "s"}
      {#if canClose}· click the start point (1) to close{:else}· click to add points{/if}
    {/if}
    {#if canClose}
      <button class="close-btn focus-ring" onclick={closeRing}>Close ring</button>
    {/if}
  </div>
</div>

<style>
  .canvas-wrap {
    display: flex;
    flex-direction: column;
    /* Fill the bounded .canvas column and let the SVG flex/shrink within it
       (height:100% would add the hint bar's height on top and overflow). */
    flex: 1 1 auto;
    min-height: 0;
  }
  svg {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    background:
      repeating-conic-gradient(var(--color-panel) 0% 25%, var(--color-panel-surface) 0% 50%) 50% /
      24px 24px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    touch-action: none;
  }
  svg.trace-mode {
    cursor: crosshair;
  }
  svg.scale-mode {
    cursor: default;
  }
  image {
    /* The traced photo is a backdrop only — never read into the export. */
    opacity: 0.92;
  }
  .hull {
    fill: color-mix(in oklch, var(--color-accent) 18%, transparent);
    stroke: var(--color-accent);
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }
  .hull.open {
    fill: none;
    stroke-dasharray: 6 4;
  }
  .hull.idle {
    opacity: 0.4;
  }
  .vertex {
    fill: var(--color-surface);
    stroke: var(--color-accent);
    vector-effect: non-scaling-stroke;
    cursor: grab;
  }
  .vertex.first {
    fill: var(--color-accent);
    stroke: var(--color-accent);
  }
  .vertex.selected {
    fill: var(--color-warning);
    stroke: var(--color-warning);
  }
  .first-halo {
    fill: none;
    stroke: var(--color-accent);
    vector-effect: non-scaling-stroke;
    opacity: 0.55;
  }
  .first-halo.armed {
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 0.8;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .first-halo.armed {
      animation: none;
      opacity: 0.7;
    }
  }
  .vertex-label {
    fill: var(--color-accent-foreground);
    text-anchor: middle;
    dominant-baseline: central;
    font-family: var(--font-mono);
    font-weight: 700;
    pointer-events: none;
  }
  .centroid {
    fill: var(--color-danger);
    pointer-events: none;
  }
  .ruler-line {
    stroke: var(--color-warning);
    vector-effect: non-scaling-stroke;
    cursor: move;
  }
  .ruler-end {
    fill: var(--color-warning);
    stroke: var(--color-bg);
    vector-effect: non-scaling-stroke;
    cursor: grab;
  }
  .ruler-label {
    fill: var(--color-warning);
    text-anchor: middle;
    font-family: var(--font-heading);
    font-weight: 700;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 2px 0;
    font-size: var(--text-2xs, 11px);
    color: var(--color-text-dim);
    font-family: var(--font-mono);
  }
  .close-btn {
    margin-left: auto;
    padding: 3px 10px;
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-sm);
    background: var(--color-accent-dim);
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }
  .close-btn:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
  }
</style>
