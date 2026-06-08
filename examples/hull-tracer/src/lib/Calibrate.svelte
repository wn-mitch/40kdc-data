<script lang="ts">
  import { distance } from "./geometry.js";
  import type { Vec2 } from "./types.js";

  // Establishes the pixels-per-inch scale two ways:
  //  • width   — the real-world width the FULL image spans (matches how the
  //              source tool records `topdownImage.widthIn`).
  //  • ruler   — drag a two-point span over a feature of known length.
  // Either way the output is a single scalar, `pxPerInch`, bound to the parent.
  let {
    imageUrl,
    imageWidth,
    imageHeight,
    pxPerInch = $bindable(),
  }: {
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    pxPerInch: number | null;
  } = $props();

  let mode = $state<"width" | "ruler">("width");

  // Mode: width.
  let widthIn = $state<number>(3.2);

  // Mode: ruler. Endpoints are placed at 25%/75% across the image once its
  // dimensions are known (kept out of the $state initializer so they track the
  // current image rather than capturing a stale initial size).
  let a = $state<Vec2>({ x: 0, y: 0 });
  let b = $state<Vec2>({ x: 0, y: 0 });
  let placed = false;
  let lengthIn = $state<number>(3.2);
  let gEl = $state<SVGGElement | null>(null);
  let dragging = $state<"a" | "b" | null>(null);
  const maxDim = $derived(Math.max(imageWidth, imageHeight, 1));

  $effect(() => {
    if (!placed && imageWidth > 0) {
      a = { x: imageWidth * 0.25, y: imageHeight * 0.5 };
      b = { x: imageWidth * 0.75, y: imageHeight * 0.5 };
      placed = true;
    }
  });

  function toImage(clientX: number, clientY: number): Vec2 {
    const ctm = gEl?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }
  function startDrag(e: PointerEvent, which: "a" | "b"): void {
    e.stopPropagation();
    dragging = which;
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: PointerEvent): void {
    if (!dragging) return;
    const p = toImage(e.clientX, e.clientY);
    if (dragging === "a") a = p;
    else b = p;
  }

  const rulerPx = $derived(distance(a, b));

  // Recompute pxPerInch whenever the active mode's inputs change. A
  // non-positive denominator yields null (export stays gated).
  $effect(() => {
    if (mode === "width") {
      pxPerInch = widthIn > 0 ? imageWidth / widthIn : null;
    } else {
      pxPerInch = lengthIn > 0 && rulerPx > 0 ? rulerPx / lengthIn : null;
    }
  });
</script>

<div class="cal">
  <div class="seg" role="tablist" aria-label="Calibration method">
    <button
      role="tab"
      aria-selected={mode === "width"}
      class:active={mode === "width"}
      class="focus-ring"
      onclick={() => (mode = "width")}>Image width</button
    >
    <button
      role="tab"
      aria-selected={mode === "ruler"}
      class:active={mode === "ruler"}
      class="focus-ring"
      onclick={() => (mode = "ruler")}>Two-point ruler</button
    >
  </div>

  {#if mode === "width"}
    <label class="field">
      <span>Real width of the full image (inches)</span>
      <input
        type="number"
        min="0.1"
        step="0.1"
        bind:value={widthIn}
        class="focus-ring"
      />
    </label>
    <p class="note">
      Use this when the photo is cropped so its full width equals a known span (e.g. a 3″ ruler laid
      edge to edge).
    </p>
  {:else}
    <div class="ruler-wrap">
      <svg
        viewBox="0 0 {imageWidth} {imageHeight}"
        preserveAspectRatio="xMidYMid meet"
        role="application"
        aria-label="Calibration ruler"
        onpointermove={moveDrag}
        onpointerup={() => (dragging = null)}
        onpointerleave={() => (dragging = null)}
      >
        <g bind:this={gEl}>
          <image href={imageUrl} x="0" y="0" width={imageWidth} height={imageHeight} opacity="0.9" />
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--color-warning)"
            stroke-width={maxDim * 0.004}
            vector-effect="non-scaling-stroke"
          />
          <circle
            cx={a.x}
            cy={a.y}
            r={maxDim * 0.012}
            fill="var(--color-warning)"
            role="button"
            tabindex="-1"
            aria-label="Ruler start"
            onpointerdown={(e) => startDrag(e, "a")}
          />
          <circle
            cx={b.x}
            cy={b.y}
            r={maxDim * 0.012}
            fill="var(--color-warning)"
            role="button"
            tabindex="-1"
            aria-label="Ruler end"
            onpointerdown={(e) => startDrag(e, "b")}
          />
        </g>
      </svg>
    </div>
    <label class="field">
      <span>Length of that span (inches)</span>
      <input type="number" min="0.1" step="0.1" bind:value={lengthIn} class="focus-ring" />
    </label>
  {/if}

  <div class="readout" aria-live="polite">
    {#if pxPerInch}
      <strong>{pxPerInch.toFixed(1)}</strong> px / inch ·
      image ≈ {(imageWidth / pxPerInch).toFixed(2)}″ × {(imageHeight / pxPerInch).toFixed(2)}″
    {:else}
      Enter a positive measurement to set the scale.
    {/if}
  </div>
</div>

<style>
  .cal {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .seg {
    display: flex;
    gap: 4px;
  }
  .seg button {
    flex: 1;
    padding: 6px 8px;
    background: var(--color-panel-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-family: var(--font-heading);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }
  .seg button.active {
    background: var(--color-accent-dim);
    border-color: var(--color-accent);
    color: var(--color-text);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--color-text-muted);
  }
  .field input {
    padding: 6px 8px;
    background: var(--color-panel);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-family: var(--font-mono);
  }
  .note {
    margin: 0;
    font-size: 11px;
    color: var(--color-text-dim);
    line-height: 1.4;
  }
  .ruler-wrap svg {
    width: 100%;
    max-height: 260px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    touch-action: none;
  }
  .ruler-wrap circle {
    cursor: grab;
  }
  .readout {
    font-size: 12px;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }
  .readout strong {
    color: var(--color-accent);
  }
</style>
