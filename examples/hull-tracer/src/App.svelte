<script lang="ts">
  import AppHeader from "../../_shared/AppHeader.svelte";
  import AppFooter from "../../_shared/AppFooter.svelte";
  import {
    LIST_BUILDER_URL,
    LAYOUT_EDITOR_URL,
    SALVO_URL,
  } from "../../_shared/links.js";
  import ImageDrop from "./lib/ImageDrop.svelte";
  import Calibrate from "./lib/Calibrate.svelte";
  import Tracer from "./lib/Tracer.svelte";
  import ExportPanel from "./lib/ExportPanel.svelte";
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

  function onImage(img: LoadedImage): void {
    // Releasing the previous blob URL keeps the tab from leaking object URLs as
    // the author swaps reference photos.
    if (image) URL.revokeObjectURL(image.url);
    image = img;
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
            <li>Drop in a top-down image.</li>
            <li>Calibrate the scale (image width, or a two-point ruler).</li>
            <li>Click around the hull to drop vertices; click the first point to close.</li>
            <li>Name it and download the JSON.</li>
          </ol>
        </div>
      </section>
    {:else}
      <section class="workspace">
        <div class="canvas">
          <Tracer
            imageUrl={image.url}
            imageWidth={image.width}
            imageHeight={image.height}
            bind:points
            bind:closed
            bind:selectedIndex
          />
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
              imageUrl={image.url}
              imageWidth={image.width}
              imageHeight={image.height}
              bind:pxPerInch
            />
          </details>

          <details open>
            <summary>2 · Export</summary>
            <ExportPanel pixelPoints={points} {closed} {pxPerInch} />
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
    min-height: 0;
    padding: 12px;
    display: flex;
  }
  .rail {
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    font-family: var(--font-heading);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    font-size: 13px;
    color: var(--color-text);
    padding: 6px 0;
    border-bottom: 1px solid var(--color-border-subtle);
    margin-bottom: 10px;
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
