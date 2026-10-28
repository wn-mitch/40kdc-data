<script lang="ts">
  import ImportPane from "./lib/import-pane.svelte";
  import AttackerPane from "./lib/attacker-pane.svelte";
  import AbilitiesPane from "./lib/abilities-pane.svelte";
  import TargetPane from "./lib/target-pane.svelte";
  import OutputPane from "./lib/output-pane.svelte";
  import ComparePane from "./lib/compare-pane.svelte";
  import ScenarioPane from "./lib/scenario-pane.svelte";
  import Pane from "../../_shared/Pane.svelte";
  import SupportModal from "../../_shared/SupportModal.svelte";
  import AppHeader from "../../_shared/AppHeader.svelte";
  import AppFooter from "../../_shared/AppFooter.svelte";
  import { LAYOUT_EDITOR_URL, MISSION_MATRIX_URL, PATREON_URL } from "../../_shared/links.js";
  import { salvo } from "./lib/store.svelte.js";

  // Auto-open panes once the user has put real content into them. Each Pane
  // also tracks an explicit user override (sticky once they click), so these
  // are *defaults*, not forced states.
  const attackerHasUnit = $derived(salvo.selectedUnitId !== null);
  const targetHasUnit = $derived(
    (salvo.targetMode === "dataset" && salvo.datasetTargetUnitId !== null) ||
      (salvo.targetMode === "roster" && salvo.rosterTargetUnitIndex !== null),
  );
  // The unit pickers live inside these panes, and changing a faction clears the unit, so their
  // auto-open latches: once open for a unit, a pane stays open while the user picks another.
  let attackerLatched = $state(false);
  let targetLatched = $state(false);
  $effect(() => {
    if (attackerHasUnit && !attackerLatched) attackerLatched = true;
    if (targetHasUnit && !targetLatched) targetLatched = true;
  });
  const attackerOpen = $derived(attackerHasUnit || attackerLatched);
  const targetOpen = $derived(targetHasUnit || targetLatched);
  const abilitiesOpen = $derived(
    Object.keys(salvo.buffOverrides).length > 0 ||
      salvo.manualBuffsActive.size > 0 ||
      salvo.contextFlags.attackerStationary ||
      salvo.contextFlags.withinHalfRange,
  );
  const scenarioOpen = $derived(Object.keys(salvo.scenario).length > 0);
  const importOpen = $derived(
    salvo.attackerRoster !== null || salvo.targetRoster !== null,
  );
</script>

<div class="app">
  <AppHeader title="Salvo" tag="40k damage calculator" appId="salvo" />

  <nav class="view-tabs">
    <button
      class:active={salvo.appView === "calculator"}
      onclick={() => (salvo.appView = "calculator")}>Calculator</button
    >
    <button
      class:active={salvo.appView === "compare"}
      onclick={() => (salvo.appView = "compare")}>Compare</button
    >
  </nav>

  {#if salvo.appView === "compare"}
    <main class="column compare">
      <section class="pane">
        <h2>Fleet comparison</h2>
        <ComparePane />
      </section>
    </main>
  {:else}
    <section class="column input">
      <Pane id="import" storagePrefix="salvo" title="Import roster" defaultOpen={importOpen}><ImportPane /></Pane>
      <Pane id="attacker" storagePrefix="salvo" title="Attacker" defaultOpen={attackerOpen}><AttackerPane /></Pane>
      <Pane id="target" storagePrefix="salvo" title="Target" defaultOpen={targetOpen}><TargetPane /></Pane>
      <Pane id="scenario" storagePrefix="salvo" title="Scenario" defaultOpen={scenarioOpen}><ScenarioPane /></Pane>
      <Pane id="abilities" storagePrefix="salvo" title="Abilities & buffs" defaultOpen={abilitiesOpen}><AbilitiesPane /></Pane>
    </section>

    <main class="column output">
      <section class="pane projection">
        <h2>Projection</h2>
        <OutputPane />
      </section>
    </main>
  {/if}

  <AppFooter
    links={[
      { label: "Terrain layouts", href: LAYOUT_EDITOR_URL },
      { label: "Mission Matrix", href: MISSION_MATRIX_URL },
    ]}
    version={__DATA_VERSION__}
    build={__BUILD_SHA__}
  />

  <SupportModal patreonUrl={PATREON_URL} appName="Salvo" />
</div>
