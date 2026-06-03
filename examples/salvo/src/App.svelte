<script lang="ts">
  import ImportPane from "./lib/import-pane.svelte";
  import AttackerPane from "./lib/attacker-pane.svelte";
  import AbilitiesPane from "./lib/abilities-pane.svelte";
  import TargetPane from "./lib/target-pane.svelte";
  import OutputPane from "./lib/output-pane.svelte";
  import Pane from "./lib/Pane.svelte";
  import { salvo } from "./lib/store.svelte.js";

  // Absolute link to the 40kdc landing page. Each example is deployed to its
  // own subdomain (salvo.alpacasoft.dev), so the landing page is a different
  // origin — a relative hop can't reach it.
  const HOME_URL = "https://40kdc.alpacasoft.dev";
  const REPO_URL = "https://github.com/alpaca-software/40kdc-data";
  const PACKAGE_URL = "https://www.npmjs.com/package/@alpaca-software/40kdc-data";
  const PUBLISHER_URL = "https://alpacasoft.dev";
  const PATREON_URL = "https://www.patreon.com/c/AlpacaSoftware";

  // Auto-open panes once the user has put real content into them. Each Pane
  // also tracks an explicit user override (sticky once they click), so these
  // are *defaults*, not forced states.
  const attackerOpen = $derived(salvo.selectedUnitId !== null);
  const targetOpen = $derived(
    (salvo.targetMode === "dataset" && salvo.datasetTargetUnitId !== null) ||
      (salvo.targetMode === "roster" && salvo.rosterTargetUnitIndex !== null),
  );
  const abilitiesOpen = $derived(
    Object.keys(salvo.buffOverrides).length > 0 ||
      salvo.manualBuffsActive.size > 0 ||
      salvo.contextFlags.attackerStationary ||
      salvo.contextFlags.withinHalfRange,
  );
  const importOpen = $derived(
    salvo.attackerRoster !== null || salvo.targetRoster !== null,
  );
</script>

<div class="app">
  <header class="app-header">
    <a class="brand" href={REPO_URL} target="_blank" rel="noreferrer noopener">
      <h1>Salvo</h1>
      <span class="tag">40k damage calculator</span>
    </a>
    <nav class="app-header-links">
      <a class="home" href={HOME_URL} aria-label="Back to 40kdc-data examples">
        ← 40kdc-data
      </a>
      <a href={REPO_URL} target="_blank" rel="noreferrer noopener" aria-label="GitHub repository">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
        </svg>
      </a>
      <a class="pkg" href={PACKAGE_URL} target="_blank" rel="noreferrer noopener">
        <code>@alpaca-software/40kdc-data</code>
      </a>
      <a class="publisher" href={PUBLISHER_URL} target="_blank" rel="noreferrer noopener">
        alpacasoft.dev
      </a>
      <a class="patreon" href={PATREON_URL} target="_blank" rel="noreferrer noopener">
        Patreon
      </a>
    </nav>
  </header>

  <section class="column input">
    <Pane id="import" title="Import roster" defaultOpen={importOpen}><ImportPane /></Pane>
    <Pane id="attacker" title="Attacker" defaultOpen={attackerOpen}><AttackerPane /></Pane>
    <Pane id="target" title="Target" defaultOpen={targetOpen}><TargetPane /></Pane>
    <Pane id="abilities" title="Abilities & buffs" defaultOpen={abilitiesOpen}><AbilitiesPane /></Pane>
  </section>

  <main class="column output">
    <section class="pane projection">
      <h2>Projection</h2>
      <OutputPane />
    </section>
  </main>

  <footer class="app-footer">
    <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
      github.com/alpaca-software/40kdc-data
    </a>
    <span class="dot" aria-hidden="true">·</span>
    <span class="muted">
      powered by
      <a href={PACKAGE_URL} target="_blank" rel="noreferrer noopener"><code>@alpaca-software/40kdc-data</code></a>
    </span>
  </footer>
</div>
