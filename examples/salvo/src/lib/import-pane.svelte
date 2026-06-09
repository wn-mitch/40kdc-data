<script lang="ts">
  import { salvo, importRosterText } from "./store.svelte.js";
  import type { AdapterTrial, RosterFormat } from "@alpaca-software/40kdc-data";
  import EmptyState from "./EmptyState.svelte";

  let attackerText = $state("");
  let attackerError = $state<string | null>(null);
  let attackerTrials = $state<AdapterTrial[]>([]);
  let attackerFormat = $state<RosterFormat | null>(null);
  let targetText = $state("");
  let targetError = $state<string | null>(null);
  let targetTrials = $state<AdapterTrial[]>([]);
  let targetFormat = $state<RosterFormat | null>(null);

  function importAttacker() {
    const { roster, format, error, trials } = importRosterText(attackerText);
    salvo.attackerRoster = roster;
    attackerError = error;
    attackerTrials = trials;
    attackerFormat = format;
    if (roster && roster.units.length > 0) {
      // Auto-pick the first resolved unit if nothing's selected yet.
      const firstResolved = roster.units.find((u) => u.ref.resolved && u.ref.id);
      if (firstResolved) {
        salvo.selectedUnitId = firstResolved.ref.id;
        salvo.selectedFactionId = roster.faction_id;
        salvo.selectedDetachmentId = roster.detachments[0]?.ref.id ?? null;
      }
    }
  }

  function importTarget() {
    const { roster, format, error, trials } = importRosterText(targetText);
    salvo.targetRoster = roster;
    targetError = error;
    targetTrials = trials;
    targetFormat = format;
    if (roster) salvo.onTargetRosterImported();
  }
</script>

<div class="row">
  <label for="attacker-paste">Attacker</label>
  <span class="dim grow">Paste any supported list — format auto-detected</span>
</div>
<textarea id="attacker-paste" bind:value={attackerText} placeholder="Paste a list (ListForge URL, NewRecruit JSON, wtc-compact, wtc-full, or simple)…" rows="4"></textarea>
<div class="row">
  <button class="primary" onclick={importAttacker} disabled={!attackerText.trim()}>Import attacker</button>
  {#if salvo.attackerRoster}
    <span class="dim">
      {salvo.attackerRoster.name} — {salvo.attackerRoster.units.length} units,
      {salvo.attackerRoster.diagnostics.resolved_units} resolved
      {#if attackerFormat}<span class="chip">{attackerFormat}</span>{/if}
    </span>
  {/if}
</div>
{#if attackerError}
  <div class="error">
    {attackerError}
    {#if attackerTrials.length > 0}
      <details>
        <summary>Per-format diagnostics</summary>
        <ul class="trials">
          {#each attackerTrials as trial}
            <li>
              <code>{trial.id}</code>: {trial.matched
                ? `matched, but parse failed — ${trial.reason ?? "no detail"}`
                : "did not match"}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>
{/if}

{#if salvo.attackerRoster}
  <div class="diagnostics">
    {#if salvo.attackerRoster.diagnostics.unresolved_units > 0}
      <span class="chip warn">{salvo.attackerRoster.diagnostics.unresolved_units} unresolved units</span>
    {/if}
    {#if salvo.attackerRoster.diagnostics.unresolved_weapons > 0}
      <span class="chip warn">{salvo.attackerRoster.diagnostics.unresolved_weapons} unresolved weapons</span>
    {/if}
  </div>
{/if}

<hr />

<div class="row">
  <label for="target-paste">Target</label>
  <span class="dim grow">Optional — for "Target → Imported list" mode</span>
</div>
<textarea id="target-paste" bind:value={targetText} placeholder="Paste a target list (optional)…" rows="3"></textarea>
<div class="row">
  <button onclick={importTarget} disabled={!targetText.trim()}>Import target</button>
  {#if salvo.targetRoster}
    <span class="dim">
      {salvo.targetRoster.name} — {salvo.targetRoster.units.length} units
      {#if targetFormat}<span class="chip">{targetFormat}</span>{/if}
    </span>
  {/if}
</div>
{#if targetError}
  <div class="error">
    {targetError}
    {#if targetTrials.length > 0}
      <details>
        <summary>Per-format diagnostics</summary>
        <ul class="trials">
          {#each targetTrials as trial}
            <li>
              <code>{trial.id}</code>: {trial.matched
                ? `matched, but parse failed — ${trial.reason ?? "no detail"}`
                : "did not match"}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>
{/if}

<EmptyState>No list to hand? Pick a unit straight from the embedded dataset in the Attacker pane.</EmptyState>

<style>
  .trials {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: 12px;
  }
  .trials code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }
</style>
