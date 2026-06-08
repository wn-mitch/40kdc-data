<script lang="ts">
  import { boundingBox, distance, polygonCentroid } from "./geometry.js";
  import type { Vec2 } from "./types.js";

  // The tracing canvas. The SVG user-space is the image's natural pixel grid
  // (viewBox 0 0 w h), with the bitmap drawn 1:1 beneath. Pointer events are
  // mapped back through the content group's screen-CTM inverse — the same
  // matrix trick the layout-editor board uses — so a click anywhere, at any
  // display scale, lands on the correct image pixel. Vertices are stored in
  // pixels; conversion to inches happens only at export.
  let {
    imageUrl,
    imageWidth,
    imageHeight,
    points = $bindable(),
    closed = $bindable(),
    selectedIndex = $bindable(),
  }: {
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    points: Vec2[];
    closed: boolean;
    selectedIndex: number | null;
  } = $props();

  let svgEl = $state<SVGSVGElement | null>(null);
  let gEl = $state<SVGGElement | null>(null);
  let dragIndex = $state<number | null>(null);

  // Handle/line sizes expressed as a fraction of the image's larger dimension,
  // so they read at a constant on-screen size whatever the display scale (image
  // and overlay scale together).
  const maxDim = $derived(Math.max(imageWidth, imageHeight, 1));
  const handleR = $derived(maxDim * 0.009);
  const lineW = $derived(maxDim * 0.004);
  const snap = $derived(maxDim * 0.02);

  const centroid = $derived(points.length >= 3 ? polygonCentroid(points) : null);
  const bbox = $derived(boundingBox(points));
  const polyAttr = $derived(points.map((p) => `${p.x},${p.y}`).join(" "));

  function toImage(clientX: number, clientY: number): Vec2 {
    const ctm = gEl?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function onBackgroundDown(e: PointerEvent): void {
    // Left button only; ignore the synthesized event from a handle (it stops
    // propagation, so this only fires for true background clicks).
    if (e.button !== 0) return;
    const p = toImage(e.clientX, e.clientY);
    if (closed) {
      selectedIndex = null;
      return;
    }
    // Snap-close: clicking near the first vertex with a real polygon closes it.
    if (points.length >= 3 && distance(p, points[0]) <= snap) {
      closed = true;
      return;
    }
    points = [...points, p];
    selectedIndex = points.length - 1;
  }

  function onHandleDown(e: PointerEvent, index: number): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectedIndex = index;
    dragIndex = index;
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragIndex === null) return;
    const p = toImage(e.clientX, e.clientY);
    const next = points.slice();
    next[dragIndex] = p;
    points = next;
  }

  function endDrag(): void {
    dragIndex = null;
  }

  function onHandleContext(e: MouseEvent, index: number): void {
    // Right-click removes a vertex.
    e.preventDefault();
    e.stopPropagation();
    deleteVertex(index);
  }

  export function deleteVertex(index: number): void {
    if (index < 0 || index >= points.length) return;
    points = points.filter((_, i) => i !== index);
    selectedIndex = null;
    if (points.length < 3) closed = false;
  }
</script>

<div class="canvas-wrap">
  <svg
    bind:this={svgEl}
    viewBox="0 0 {imageWidth} {imageHeight}"
    preserveAspectRatio="xMidYMid meet"
    role="application"
    aria-label="Hull tracing canvas"
    onpointerdown={onBackgroundDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointerleave={endDrag}
  >
    <g bind:this={gEl}>
      <image href={imageUrl} x="0" y="0" width={imageWidth} height={imageHeight} />

      {#if points.length >= 2}
        <polygon
          points={polyAttr}
          class="hull"
          class:open={!closed}
          style="stroke-width:{lineW}"
        />
      {/if}

      {#if centroid}
        <circle cx={centroid.x} cy={centroid.y} r={handleR * 0.6} class="centroid" />
      {/if}

      {#each points as p, i (i)}
        <circle
          cx={p.x}
          cy={p.y}
          r={handleR}
          class="vertex"
          class:first={i === 0 && !closed}
          class:selected={i === selectedIndex}
          style="stroke-width:{lineW}"
          role="button"
          tabindex="-1"
          aria-label={`Vertex ${i + 1}`}
          onpointerdown={(e) => onHandleDown(e, i)}
          oncontextmenu={(e) => onHandleContext(e, i)}
        />
      {/each}
    </g>
  </svg>

  {#if bbox}
    <div class="hint">
      {points.length} point{points.length === 1 ? "" : "s"}
      {#if !closed && points.length >= 3}· click the first point to close{/if}
      {#if closed}· closed · right-click a point to remove{/if}
    </div>
  {/if}
</div>

<style>
  .canvas-wrap {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
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
    cursor: crosshair;
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
  .vertex {
    fill: var(--color-surface);
    stroke: var(--color-accent);
    vector-effect: non-scaling-stroke;
    cursor: grab;
  }
  .vertex.first {
    fill: var(--color-accent);
  }
  .vertex.selected {
    fill: var(--color-warning);
    stroke: var(--color-warning);
  }
  .centroid {
    fill: var(--color-danger);
    pointer-events: none;
  }
  .hint {
    padding: 6px 2px 0;
    font-size: var(--text-2xs, 11px);
    color: var(--color-text-dim);
    font-family: var(--font-mono);
  }
</style>
