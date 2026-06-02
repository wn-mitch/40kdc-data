<script lang="ts">
  import {
    CATALOG,
    addTemplate,
    blankLayout,
    loadEmbedded,
    resolve,
    toCanonicalJson,
    type EditLayout,
    type Vec2,
    type EditPiece,
  } from "./lib/model.js";
  import type { TerrainTemplate } from "@alpaca-software/40kdc-data";
  import Board from "./lib/Board.svelte";
  import Inspector from "./lib/Inspector.svelte";

  const HOME_URL = "../../";
  const REPO_URL = "https://github.com/tabletop-developer-consortium/40kdc-data";

  const EMBEDDED = [
    { id: "gw-11e-crucible", label: "Crucible of Battle" },
    { id: "gw-11e-hammer-anvil", label: "Hammer and Anvil" },
  ];

  let layout = $state<EditLayout>(loadEmbedded("gw-11e-crucible") ?? blankLayout());
  let selectedId = $state<string | null>(null);

  const resolved = $derived(resolve(layout));
  const selectedPiece = $derived<EditPiece | null>(
    selectedId ? layout.pieces.find((p) => p.id === selectedId) ?? null : null,
  );
  const exportText = $derived(JSON.stringify(toCanonicalJson(layout), null, 2));

  const areas = CATALOG.filter((t) => t.kind === "area");
  const features = CATALOG.filter((t) => t.kind === "feature");

  function loadLayout(id: string): void {
    if (id === "__new__") {
      layout = blankLayout();
    } else {
      layout = loadEmbedded(id) ?? blankLayout();
    }
    selectedId = null;
  }

  function add(t: TerrainTemplate): void {
    selectedId = addTemplate(layout, t).id;
  }
  function move(id: string, position: Vec2): void {
    const p = layout.pieces.find((q) => q.id === id);
    if (p) p.position = position;
  }
  function remove(id: string): void {
    layout.pieces = layout.pieces.filter((p) => p.id !== id);
    if (selectedId === id) selectedId = null;
  }

  let copied = $state(false);
  async function copyJson(): Promise<void> {
    await navigator.clipboard.writeText(exportText);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }
  function downloadJson(): void {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${layout.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="app">
  <header class="app-header">
    <a class="brand" href={REPO_URL} target="_blank" rel="noreferrer noopener">
      <h1>Layout Editor</h1>
      <span class="tag">11e terrain layouts</span>
    </a>
    <nav>
      <select aria-label="Load layout" onchange={(e) => loadLayout(e.currentTarget.value)} value={layout.id}>
        <option value="__new__">＋ New layout</option>
        {#each EMBEDDED as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
      </select>
      <a class="home" href={HOME_URL}>← 40kdc-data</a>
    </nav>
  </header>

  <main>
    <aside class="palette">
      <h2>Templates</h2>
      <h4>Areas</h4>
      <div class="chips">
        {#each areas as t (t.id)}<button onclick={() => add(t)}>{t.name}</button>{/each}
      </div>
      <h4>Features</h4>
      <div class="chips">
        {#each features as t (t.id)}<button class="feature" onclick={() => add(t)}>{t.name}</button>{/each}
      </div>
    </aside>

    <section class="canvas">
      <Board {layout} {resolved} {selectedId} onselect={(id) => (selectedId = id)} onmove={move} />
      <p class="status">{layout.pieces.length} pieces · drag to move · the dot marks the selected piece's centroid</p>
    </section>

    <aside class="side">
      <Inspector piece={selectedPiece} ondelete={remove} />
      <section class="export">
        <h2>Canonical JSON
          <span class="actions">
            <button onclick={copyJson}>{copied ? "copied" : "copy"}</button>
            <button onclick={downloadJson}>download</button>
          </span>
        </h2>
        <textarea readonly>{exportText}</textarea>
      </section>
    </aside>
  </main>
</div>

<style>
  .app {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem 1.25rem 3rem;
  }
  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #243140;
    padding-bottom: 0.6rem;
    margin-bottom: 1rem;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    text-decoration: none;
    color: inherit;
  }
  h1 {
    margin: 0;
    font-family: "Barlow Condensed", sans-serif;
    font-size: 1.7rem;
    letter-spacing: 0.02em;
  }
  .tag {
    color: #7d8b99;
    font-size: 0.85rem;
  }
  nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .home {
    color: #9fb0c0;
    text-decoration: none;
    font-size: 0.85rem;
  }
  main {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr) 360px;
    gap: 1rem;
    align-items: start;
  }
  h2 {
    font-family: "Barlow Condensed", sans-serif;
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  h4 {
    margin: 0.7rem 0 0.3rem;
    color: #9fb0c0;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .chips button {
    font: inherit;
    font-size: 0.76rem;
    background: #182230;
    color: #cdd9e5;
    border: 1px solid #2a3a4a;
    border-radius: 4px;
    padding: 0.2rem 0.45rem;
    cursor: pointer;
  }
  .chips button.feature {
    border-color: #5a4424;
    color: #e6c98c;
  }
  .status {
    color: #7d8b99;
    font-size: 0.78rem;
    margin-top: 0.4rem;
  }
  nav select,
  .export textarea {
    background: #0b0f14;
    color: #e6edf3;
    border: 1px solid #2a3a4a;
    border-radius: 4px;
    font: inherit;
  }
  nav select {
    padding: 0.25rem 0.4rem;
    font-size: 0.85rem;
  }
  .export {
    margin-top: 1rem;
  }
  .export h2 {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .actions {
    display: flex;
    gap: 0.3rem;
  }
  .actions button {
    font: inherit;
    font-size: 0.74rem;
    background: #182230;
    color: #cdd9e5;
    border: 1px solid #2a3a4a;
    border-radius: 4px;
    padding: 0.15rem 0.5rem;
    cursor: pointer;
  }
  .export textarea {
    width: 100%;
    height: 280px;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.72rem;
    padding: 0.5rem;
    resize: vertical;
  }
  @media (max-width: 980px) {
    main {
      grid-template-columns: 1fr;
    }
  }
</style>
