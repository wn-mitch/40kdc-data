<script lang="ts">
  import {
    CATALOG,
    addTemplate,
    blankLayout,
    loadEmbedded,
    resolve,
    toCanonicalJson,
    movePiece,
    orientPiece,
    setLinkGroup,
    deletePiece,
    repairTwins,
    unpairTwins,
    deploymentZones,
    defaultDeploymentFor,
    DEPLOYMENT_PATTERNS,
    type EditLayout,
    type EditPiece,
    type Mirror,
    type SolverRef,
    type SolverLine,
    type SolverViz,
    type DeployZone,
  } from "./lib/model.js";
  import type { TerrainTemplate } from "@alpaca-software/40kdc-data";
  import Board from "./lib/Board.svelte";
  import Inspector from "./lib/Inspector.svelte";
  import Palette from "./lib/Palette.svelte";

  const HOME_URL = "https://40kdc.alpacasoft.dev";
  const REPO_URL = "https://github.com/alpaca-software/40kdc-data";
  const PUBLISHER_URL = "https://alpacasoft.dev";
  const PATREON_URL = "https://www.patreon.com/c/AlpacaSoftware";

  const EMBEDDED = [
    { id: "gw-11e-crucible", label: "Crucible of Battle" },
    { id: "gw-11e-hammer-anvil", label: "Hammer and Anvil" },
    { id: "gw-11e-search-destroy", label: "Search and Destroy (draft)" },
  ];

  let symmetric = $state(true);
  let layout = $state<EditLayout>(loadEmbedded("gw-11e-crucible", true) ?? blankLayout());
  let selectedId = $state<string | null>(null);
  let deployment = $state<string | null>(defaultDeploymentFor("gw-11e-crucible"));
  const zones = $derived<DeployZone[]>(deploymentZones(deployment));

  let solverHover = $state<SolverRef | null>(null);
  let solverLines = $state<SolverLine[]>([]);
  const solverViz = $derived<SolverViz>({ hover: solverHover, lines: solverLines });

  const resolved = $derived(resolve(layout));
  const selectedPiece = $derived<EditPiece | null>(
    selectedId ? layout.pieces.find((p) => p.id === selectedId) ?? null : null,
  );
  const exportText = $derived(JSON.stringify(toCanonicalJson(layout), null, 2));

  const areas = CATALOG.filter((t) => t.kind === "area");
  const features = CATALOG.filter((t) => t.kind === "feature");

  function loadLayout(id: string): void {
    layout = id === "__new__" ? blankLayout() : loadEmbedded(id, symmetric) ?? blankLayout();
    selectedId = null;
    deployment = id === "__new__" ? null : defaultDeploymentFor(id);
  }
  function toggleSymmetry(): void {
    symmetric = !symmetric;
    if (symmetric) repairTwins(layout);
    else unpairTwins(layout);
  }

  function add(t: TerrainTemplate): void {
    selectedId = addTemplate(layout, t, symmetric).id;
  }
  function onmove(id: string, position: { x: number; y: number }): void {
    movePiece(layout, id, position);
  }
  function onorient(id: string, patch: { rotation_degrees?: number; mirror?: Mirror }): void {
    orientPiece(layout, id, patch);
  }
  function onlinkgroup(id: string, group: string | undefined): void {
    setLinkGroup(layout, id, group);
  }
  function remove(id: string): void {
    const twin = layout.pieces.find((p) => p.id === id)?.twin_id;
    deletePiece(layout, id);
    if (selectedId === id || selectedId === twin) selectedId = null;
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
      <span class="tag">11e terrain layouts · portrait</span>
    </a>
    <nav>
      <button
        class="sym {symmetric ? 'on' : ''}"
        onclick={toggleSymmetry}
        title="Mirror every piece across the board centre (180°)"
      >
        {symmetric ? "⟳ Symmetry on" : "⟳ Symmetry off"}
      </button>
      <select aria-label="Load layout" onchange={(e) => loadLayout(e.currentTarget.value)} value={layout.id}>
        <option value="__new__">＋ New layout</option>
        {#each EMBEDDED as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
      </select>
      <select
        aria-label="Deployment overlay"
        value={deployment ?? ""}
        onchange={(e) => (deployment = e.currentTarget.value || null)}
      >
        <option value="">No deployment</option>
        {#each DEPLOYMENT_PATTERNS as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
      </select>
      <a class="home" href={HOME_URL}>← 40kdc-data</a>
      <a class="home" href={PUBLISHER_URL} target="_blank" rel="noreferrer noopener">alpacasoft.dev</a>
      <a class="home" href={PATREON_URL} target="_blank" rel="noreferrer noopener">Patreon</a>
    </nav>
  </header>

  <main>
    <aside class="rail palette-rail">
      <Palette {areas} {features} onadd={add} />
    </aside>

    <section class="canvas">
      <Board
        {layout}
        {resolved}
        {selectedId}
        {selectedPiece}
        solver={solverViz}
        {zones}
        onselect={(id) => (selectedId = id)}
        {onmove}
        {onorient}
      />
      <p class="status">
        {layout.pieces.length} pieces · drag to move · rotate/flip handles on the selected piece
        {#if symmetric}· edits mirror across the centre{/if}
      </p>
    </section>

    <aside class="rail side">
      <Inspector
        piece={selectedPiece}
        ondelete={remove}
        {onmove}
        {onorient}
        {onlinkgroup}
        onsolverhover={(ref) => (solverHover = ref)}
        onsolverlines={(lines) => (solverLines = lines)}
      />
      <section class="export">
        <h2>
          Canonical JSON
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
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 0.7rem 1rem 0.9rem;
  }
  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--rim);
    padding-bottom: 0.55rem;
    margin-bottom: 0.8rem;
    flex: 0 0 auto;
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
    color: var(--text-mute);
    font-size: 0.85rem;
  }
  nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .home {
    color: var(--text-dim);
    text-decoration: none;
    font-size: 0.85rem;
  }
  main {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 380px;
    gap: 0.9rem;
    align-items: stretch;
  }
  .rail {
    overflow-y: auto;
    min-height: 0;
  }
  .canvas {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .canvas :global(.board) {
    flex: 1 1 auto;
    min-height: 0;
  }
  h2 {
    font-family: "Barlow Condensed", sans-serif;
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  .status {
    color: var(--text-mute);
    font-size: 0.78rem;
    margin: 0.4rem 0 0;
    flex: 0 0 auto;
  }
  nav select,
  .export textarea {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--rim);
    border-radius: 4px;
    font: inherit;
  }
  nav select {
    padding: 0.25rem 0.4rem;
    font-size: 0.85rem;
  }
  .sym {
    font: inherit;
    font-size: 0.8rem;
    background: var(--surface-2);
    color: var(--text-dim);
    border: 1px solid var(--rim);
    border-radius: 4px;
    padding: 0.25rem 0.55rem;
    cursor: pointer;
  }
  .sym.on {
    border-color: var(--accent);
    background: var(--accent-fill);
    color: var(--accent-strong);
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
    background: var(--surface-2);
    color: var(--text-dim);
    border: 1px solid var(--rim);
    border-radius: 4px;
    padding: 0.15rem 0.5rem;
    cursor: pointer;
  }
  .export textarea {
    width: 100%;
    height: 240px;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.72rem;
    padding: 0.5rem;
    resize: vertical;
  }
</style>
