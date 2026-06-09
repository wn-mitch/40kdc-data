<script lang="ts">
  import AppHeader from "../../_shared/AppHeader.svelte";
  import AppFooter from "../../_shared/AppFooter.svelte";
  import { LIST_BUILDER_URL, LAYOUT_EDITOR_URL, SALVO_URL } from "../../_shared/links.js";
  import ImageDrop from "./lib/ImageDrop.svelte";
  import Calibrate from "./lib/Calibrate.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import TerrainPreview from "./lib/TerrainPreview.svelte";
  import ExportPanel from "./lib/ExportPanel.svelte";
  import NotesPanel from "./lib/NotesPanel.svelte";
  import { boundsSize } from "./lib/geometry.js";
  import type { Vec2 } from "./lib/types.js";

  interface LoadedImage {
    url: string;
    width: number;
    height: number;
    name: string;
  }

  let image = $state<LoadedImage | null>(null);
  let pxPerInch = $state<number | null>(null);
  let points = $state<Vec2[]>([]);
  let closed = $state(false);
  let selectedIndex = $state<number | null>(null);

  // Canvas mode + calibration. The ruler endpoints live here so they render on
  // the main canvas (large, grabbable) while Calibrate owns only the math.
  let mode = $state<"scale" | "trace" | "preview">("scale");
  let method = $state<"width" | "ruler">("width");
  let rulerA = $state<Vec2>({ x: 0, y: 0 });
  let rulerB = $state<Vec2>({ x: 0, y: 0 });

  // Hull identity, shared between the export and the notes block.
  let name = $state("");
  let id = $state("");

  const showRuler = $derived(mode === "scale" && method === "ruler");
  // Preview needs a real scale and a footprint to place the model at true size.
  const canPreview = $derived(pxPerInch !== null && pxPerInch > 0 && points.length >= 3);

  // Live footprint in inches, for the notes block (null until scaled / traced).
  const liveSize = $derived.by(() => {
    if (pxPerInch === null || pxPerInch <= 0 || points.length < 1) return null;
    const inches = points.map((p) => ({ x: p.x / pxPerInch!, y: p.y / pxPerInch! }));
    return boundsSize(inches);
  });

  const scaleLabel = $derived(pxPerInch ? `${pxPerInch.toFixed(0)} px/in` : "no scale");

  function onImage(img: LoadedImage): void {
    // Releasing the previous blob URL keeps the tab from leaking object URLs as
    // the author swaps reference photos. (A no-op for a pasted http(s) URL.)
    if (image) URL.revokeObjectURL(image.url);
    image = img;
    rulerA = { x: img.width * 0.25, y: img.height * 0.5 };
    rulerB = { x: img.width * 0.75, y: img.height * 0.5 };
    mode = "scale";
    resetTrace();
  }

  function resetTrace(): void {
    points = [];
    closed = false;
    selectedIndex = null;
  }

  function clearImage(): void {
    if (image) URL.revokeObjectURL(image.url);
    image = null;
    pxPerInch = null;
    resetTrace();
  }

  function onKeydown(e: KeyboardEvent): void {
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedIndex !== null) {
      e.preventDefault();
      points = points.filter((_, i) => i !== selectedIndex);
      selectedIndex = null;
      if (points.length < 3) closed = false;
    }
  }

  $effect(() => {
    // Final safety net: release the object URL when the app unmounts.
    return () => {
      if (image) URL.revokeObjectURL(image.url);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <AppHeader title="Hull Tracer" tag="40kdc model collision outlines" />

  <main>
    {#if !image}
      <section class="intro">
        <ImageDrop {onImage} />
        <div class="how">
          <h2>What this does</h2>
          <p>
            Trace the footprint of a model from a top-down photo and export a <code
              >hull-shape</code
            > — the 2D collision polygon a vehicle uses instead of a round/oval base. The outline is
            faction-agnostic: one chassis outline can be tagged onto every model that shares it.
          </p>
          <ol>
            <li>Drop in a top-down image (or paste a URL).</li>
            <li>Calibrate the scale (image width, or a two-point ruler on the canvas).</li>
            <li>Switch to Trace, click around the hull, then click the start point to close.</li>
            <li>Name it and download the JSON.</li>
          </ol>
        </div>
      </section>
    {:else}
      <section class="workspace">
        <div class="canvas">
          <div class="canvas-bar">
            <div class="seg" role="tablist" aria-label="Canvas mode">
              <button
                role="tab"
                aria-selected={mode === "scale"}
                class:active={mode === "scale"}
                class="focus-ring"
                onclick={() => (mode = "scale")}>1 · Scale</button
              >
              <button
                role="tab"
                aria-selected={mode === "trace"}
                class:active={mode === "trace"}
                class="focus-ring"
                onclick={() => (mode = "trace")}>2 · Trace</button
              >
              <button
                role="tab"
                aria-selected={mode === "preview"}
                class:active={mode === "preview"}
                class="focus-ring"
                disabled={!canPreview}
                title={canPreview
                  ? "Preview the model on a random terrain layout"
                  : "Calibrate a scale and trace at least 3 points first"}
                onclick={() => (mode = "preview")}>3 · Preview</button
              >
            </div>
            <div class="status">
              {points.length} pt{points.length === 1 ? "" : "s"} · {closed ? "closed" : "open"} · {scaleLabel}
            </div>
          </div>

          {#if mode === "preview"}
            <TerrainPreview pixelPoints={points} {pxPerInch} />
          {:else}
            <Canvas
              imageUrl={image.url}
              imageWidth={image.width}
              imageHeight={image.height}
              {mode}
              {showRuler}
              bind:points
              bind:closed
              bind:selectedIndex
              bind:rulerA
              bind:rulerB
            />
          {/if}
        </div>

        <aside class="rail">
          <div class="rail-head">
            <span class="file" title={image.name}>{image.name}</span>
            <div class="rail-actions">
              <button class="link" onclick={resetTrace}>Clear trace</button>
              <button class="link" onclick={clearImage}>Replace image</button>
            </div>
          </div>

          <details open>
            <summary>1 · Scale</summary>
            <Calibrate
              imageWidth={image.width}
              imageHeight={image.height}
              {rulerA}
              {rulerB}
              bind:pxPerInch
              bind:method
            />
          </details>

          <details open>
            <summary>2 · Export</summary>
            <ExportPanel pixelPoints={points} {closed} {pxPerInch} bind:name bind:id />
          </details>

          <details>
            <summary>3 · Notes <span class="opt">optional</span></summary>
            <NotesPanel {name} {id} bounds={liveSize} />
          </details>
        </aside>
      </section>
    {/if}
  </main>

  <AppFooter
    links={[
      { label: "List Builder", href: LIST_BUILDER_URL },
      { label: "Terrain layouts", href: LAYOUT_EDITOR_URL },
      { label: "Salvo", href: SALVO_URL },
    ]}
    version={__DATA_VERSION__}
    build={__BUILD_SHA__}
  />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  main {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  .intro {
    margin: auto;
    display: grid;
    grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr);
    gap: 32px;
    align-items: center;
    max-width: 920px;
    padding: 32px 24px;
  }
  .how h2 {
    margin: 0 0 8px;
    font-family: var(--font-heading);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-accent);
    font-size: 16px;
  }
  .how p {
    margin: 0 0 12px;
    color: var(--color-text-muted);
    font-size: 14px;
  }
  .how code {
    font-family: var(--font-mono);
    color: var(--color-text);
  }
  .how ol {
    margin: 0;
    padding-left: 20px;
    color: var(--color-text-muted);
    font-size: 13px;
    line-height: 1.7;
  }
  .workspace {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 340px;
  }
  .canvas {
    min-width: 0;
    /* Grid items default to min-height:auto, which would let the SVG's
       intrinsic height push the row past the viewport and force a scroll.
       Pin it to 0 so the canvas clamps to the available row height. */
    min-height: 0;
    overflow: hidden;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .canvas-bar {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .seg {
    display: flex;
    gap: 4px;
  }
  .seg button {
    padding: 6px 14px;
    background: var(--color-panel-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-family: var(--font-heading);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    box-shadow: var(--shadow-sm);
  }
  .seg button.active {
    background: var(--color-accent-dim);
    border-color: var(--color-accent);
    color: var(--color-text);
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .status {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-text-dim);
    font-variant-numeric: tabular-nums;
  }
  .rail {
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow-sm);
  }
  .rail-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .file {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rail-actions {
    display: flex;
    gap: 12px;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--color-text-muted);
    font-size: 12px;
    text-decoration: underline;
  }
  .link:hover {
    color: var(--color-accent);
  }
  details summary {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-heading);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    font-size: 13px;
    color: var(--color-text);
    padding: 6px 0;
    border-bottom: 1px solid var(--color-border-subtle);
    margin-bottom: 10px;
    cursor: pointer;
  }
  .opt {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0;
    text-transform: none;
    color: var(--color-text-dim);
  }
  @media (max-width: 760px) {
    .intro {
      grid-template-columns: 1fr;
      gap: 20px;
    }
    .workspace {
      grid-template-columns: 1fr;
    }
    .canvas {
      min-height: 50vh;
    }
    .rail {
      border-left: 0;
      border-top: 1px solid var(--color-border);
    }
  }
</style>
