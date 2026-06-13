<script lang="ts">
  import { Dataset } from "@alpaca-software/40kdc-data";
  import AppHeader from "../../_shared/AppHeader.svelte";
  import AppFooter from "../../_shared/AppFooter.svelte";
  import LayoutDiagram from "../../_shared/LayoutDiagram.svelte";
  import LayoutThumb from "../../_shared/LayoutThumb.svelte";
  import MatchupMatrix from "../../_shared/MatchupMatrix.svelte";
  import SupportModal from "../../_shared/SupportModal.svelte";
  import { diagramModel } from "../../_shared/layout-geometry.js";
  import { matrixCells, type MatrixCell } from "../../_shared/matchup-grid.js";
  import { MISSION_MATRIX_URL, PATREON_URL, SALVO_URL } from "../../_shared/links.js";

  /**
   * The public face of the app: a read-only viewer over the embedded terrain
   * layouts, navigated by the 5×5 force-disposition matrix. Tap a pairing,
   * page through its variants (buttons, arrow keys, or swipe), read the card
   * off a phone at the table. Authoring lives behind #edit — this module
   * never imports the editor model, so the default bundle stays light.
   */
  const ds = Dataset.embedded();
  const cells = matrixCells(ds);
  const authored = cells.reduce((n, c) => n + c.layouts.length, 0);

  // Land on the first authored pairing so the page opens showing a board.
  let selected = $state<MatrixCell | null>(cells.find((c) => c.layouts.length > 0) ?? null);
  let variant = $state<number>(1);
  $effect.pre(() => {
    // Snap to the pairing's first authored variant whenever the pairing changes.
    variant = selected?.layouts[0]?.variant ?? 1;
  });

  // The standard three slots, plus any rare higher-numbered variants the data carries.
  const variantSlots = $derived.by(() => {
    const extras = (selected?.layouts ?? [])
      .map((l) => l.variant ?? 0)
      .filter((v) => v > 3)
      .sort((a, b) => a - b);
    return [1, 2, 3, ...extras];
  });

  const active = $derived(selected?.layouts.find((l) => (l.variant ?? 0) === variant));
  const model = $derived(active ? diagramModel(ds, active) : null);
  const patternName = $derived(
    active?.deployment_pattern_id
      ? (ds.deploymentPatterns.get(active.deployment_pattern_id)?.name ??
          active.deployment_pattern_id)
      : null,
  );

  let variantsEl: HTMLElement | null = $state(null);
  function pick(c: MatrixCell): void {
    selected = c;
    // One column below 960px: the variants live off-screen under the matrix.
    if (window.matchMedia("(max-width: 959px)").matches) {
      variantsEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function step(dir: 1 | -1): void {
    const slots = variantSlots;
    const at = slots.indexOf(variant);
    const next = slots[at + dir];
    if (next !== undefined) variant = next;
  }

  function onPagerKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    }
  }

  // Horizontal swipe on the card pages variants; vertical motion stays a scroll.
  let swipeFrom: { x: number; y: number } | null = null;
  function onCardPointerDown(e: PointerEvent): void {
    swipeFrom = { x: e.clientX, y: e.clientY };
  }
  function onCardPointerUp(e: PointerEvent): void {
    if (!swipeFrom) return;
    const dx = e.clientX - swipeFrom.x;
    const dy = e.clientY - swipeFrom.y;
    swipeFrom = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }
</script>

<div class="app">
  <AppHeader title="Terrain Layouts" tag="11e mission pairings · 60×44 portrait">
    {#snippet nav()}
      <a class="edit-link" href="#edit" title="Open the layout authoring editor">✎ Editor</a>
    {/snippet}
  </AppHeader>

  <main>
    <section class="picker">
      <p class="lede">
        Your Force Disposition is the row, your opponent's the column. Both orders land on the
        same table. <span class="coverage">{authored} / 45 layouts</span>
      </p>
      <MatchupMatrix {ds} onpick={pick} selectedKey={selected?.key ?? null}>
        {#snippet cell(c)}
          {#if c.layouts[0]}
            <LayoutThumb {ds} layout={c.layouts[0]} />
          {/if}
          <span class="cell-dots" aria-hidden="true">
            {#each [1, 2, 3] as v (v)}
              <span class="cell-dot" class:on={v <= c.layouts.length}></span>
            {/each}
          </span>
        {/snippet}
      </MatchupMatrix>
    </section>

    <section class="variants" bind:this={variantsEl} aria-label="Layouts for the picked pairing">
      {#if selected}
        <header class="variants-head">
          <h2>{selected.label}</h2>
          <div class="slots" role="group" aria-label="Layout variant">
            {#each variantSlots as v (v)}
              {@const isAuthored = selected.layouts.some((l) => (l.variant ?? 0) === v)}
              <button
                type="button"
                class="slot"
                class:active={v === variant}
                class:unauthored={!isAuthored}
                aria-pressed={v === variant}
                aria-label="Layout variant {v}{isAuthored ? '' : ' (coming soon)'}"
                onclick={() => (variant = v)}
                onkeydown={onPagerKeydown}
              >
                {v}
              </button>
            {/each}
          </div>
        </header>

        {#if active && model}
          <div class="card">
            <div class="card-head">
              <span class="card-name">{active.name}</span>
              <span class="card-meta">
                {#if patternName}{patternName}{/if}{#if active.source}{patternName
                    ? " · "
                    : ""}{active.source}{/if}
              </span>
            </div>
            <!-- Swipe is a pointer-only convenience; the variant buttons and
                 arrow keys are the accessible path to the same pages. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="board"
              onpointerdown={onCardPointerDown}
              onpointerup={onCardPointerUp}
            >
              <LayoutDiagram
                pieces={model.pieces}
                pieceCategories={model.pieceCategories}
                zones={model.zones}
                divider={model.divider}
                markers={model.markers}
                guides={model.guides}
              />
            </div>
            {#if active.description}
              <p class="card-note">{active.description}</p>
            {/if}
            <p class="hint">
              Dimensions run from the board edge to the marked corner; place with a tape measure.
              Swipe or use ←/→ for the other variants.
            </p>
          </div>
        {:else}
          <div class="coming-soon">Layout {variant} for this pairing: coming soon.</div>
        {/if}
      {/if}
    </section>
  </main>

  <AppFooter
    links={[
      { label: "Salvo", href: SALVO_URL },
      { label: "Mission Matrix", href: MISSION_MATRIX_URL },
    ]}
    version={__DATA_VERSION__}
    build={__BUILD_SHA__}
  />
  <SupportModal patreonUrl={PATREON_URL} appName="Terrain Layouts" />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .edit-link {
    color: var(--text-mute);
    text-decoration: none;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .edit-link:hover,
  .edit-link:focus-visible {
    color: var(--accent);
  }
  main {
    flex: 1 1 auto;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.4rem;
    align-items: start;
  }
  @media (min-width: 960px) {
    main {
      grid-template-columns: minmax(360px, 460px) minmax(0, 1fr);
      gap: 2rem;
    }
    .picker {
      position: sticky;
      top: 1rem;
    }
  }
  .lede {
    margin: 0 0 0.8rem;
    color: var(--text-dim);
    font-size: 0.85rem;
    line-height: 1.45;
    max-width: 65ch;
  }
  .coverage {
    color: var(--text-mute);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .cell-dots {
    display: flex;
    gap: 3px;
    justify-content: center;
    margin-top: 0.25rem;
  }
  .cell-dot {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: var(--rim-strong);
  }
  .cell-dot.on {
    background: var(--accent);
  }

  .variants-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
    margin-bottom: 0.8rem;
  }
  h2 {
    margin: 0;
    font-family: "Barlow Condensed", sans-serif;
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .slots {
    display: flex;
    gap: 0.4rem;
  }
  .slot {
    width: 2.75rem;
    height: 2.75rem;
    display: grid;
    place-items: center;
    font: inherit;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 1rem;
    background: var(--surface-2);
    color: var(--text-dim);
    border: 1px solid var(--rim-strong);
    border-radius: 4px;
    cursor: pointer;
    transition:
      border-color 120ms ease-out,
      background 120ms ease-out,
      color 120ms ease-out;
  }
  @media (min-width: 960px) {
    .slot {
      width: 2rem;
      height: 2rem;
      font-size: 0.85rem;
    }
  }
  .slot:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .slot.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }
  .slot.unauthored {
    border-style: dashed;
    color: var(--text-mute);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-width: 620px;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
  }
  .card-name {
    font-family: "Barlow Condensed", sans-serif;
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .card-meta {
    font-family: "Barlow Condensed", sans-serif;
    font-size: 0.78rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--text-mute);
  }
  .board {
    /* Horizontal swipes page variants; vertical drags keep scrolling the page. */
    touch-action: pan-y;
  }
  .card-note {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.82rem;
    line-height: 1.45;
    max-width: 65ch;
  }
  .hint {
    margin: 0;
    color: var(--text-mute);
    font-size: 0.75rem;
    line-height: 1.45;
    max-width: 65ch;
  }
  .coming-soon {
    border: 1px dashed var(--rim-strong);
    border-radius: 6px;
    background: var(--surface-1);
    padding: 2.2rem 1rem;
    text-align: center;
    color: var(--text-mute);
    font-size: 0.85rem;
    max-width: 620px;
  }
</style>
