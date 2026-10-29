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

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function importTarget() {
    const { roster, format, error, trials } = importRosterText(targetText);
    salvo.targetRoster = roster;
    targetError = error;
    targetTrials = trials;
    targetFormat = format;
    if (roster) salvo.onTargetRosterImported();
  }
</script>

<label class="field-label" for="attacker-paste">Attacker list</label>
<p class="field-hint dim" id="attacker-paste-hint">Paste a list in any supported format; Salvo detects which.</p>
<textarea
  id="attacker-paste"
  aria-describedby="attacker-paste-hint"
  bind:value={attackerText}
  placeholder="ListForge URL, NewRecruit JSON, WTC compact or full, or a plain text list"
  rows="4"
></textarea>
<div class="row">
  <button class="primary" onclick={importAttacker} disabled={!attackerText.trim()}>Import attacker</button>
  {#if salvo.attackerRoster}
    <span class="dim" role="status">
      <span class="success">Imported</span> {salvo.attackerRoster.name}:
      {plural(salvo.attackerRoster.units.length, "unit")},
      {salvo.attackerRoster.diagnostics.resolved_units} matched
      {#if attackerFormat}<span class="chip">{attackerFormat}</span>{/if}
    </span>
  {/if}
</div>
{#if attackerError}
  <div class="error" role="alert">
    Couldn't read that list: {attackerError}
    {#if attackerTrials.length > 0}
      <details>
        <summary>Why each format was rejected</summary>
        <ul class="trials">
          {#each attackerTrials as trial}
            <li>
              <code>{trial.id}</code>: {trial.matched
                ? `recognised, but could not be read: ${trial.reason ?? "no detail"}`
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
      <span class="chip warn">{plural(salvo.attackerRoster.diagnostics.unresolved_units, "unit")} not found</span>
    {/if}
    {#if salvo.attackerRoster.diagnostics.unresolved_weapons > 0}
      <span class="chip warn">{plural(salvo.attackerRoster.diagnostics.unresolved_weapons, "weapon")} not found</span>
    {/if}
  </div>
{/if}

<hr />

<label class="field-label" for="target-paste">Target list <span class="dim">(optional)</span></label>
<p class="field-hint dim" id="target-paste-hint">Lets you pick targets from the opponent's list.</p>
<textarea
  id="target-paste"
  aria-describedby="target-paste-hint"
  bind:value={targetText}
  placeholder="Opponent's list, any supported format"
  rows="3"
></textarea>
<div class="row">
  <button onclick={importTarget} disabled={!targetText.trim()}>Import target</button>
  {#if salvo.targetRoster}
    <span class="dim" role="status">
      <span class="success">Imported</span> {salvo.targetRoster.name}:
      {plural(salvo.targetRoster.units.length, "unit")}
      {#if targetFormat}<span class="chip">{targetFormat}</span>{/if}
    </span>
  {/if}
</div>
{#if targetError}
  <div class="error" role="alert">
    Couldn't read that list: {targetError}
    {#if targetTrials.length > 0}
      <details>
        <summary>Why each format was rejected</summary>
        <ul class="trials">
          {#each targetTrials as trial}
            <li>
              <code>{trial.id}</code>: {trial.matched
                ? `recognised, but could not be read: ${trial.reason ?? "no detail"}`
                : "did not match"}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>
{/if}

{#if !salvo.attackerRoster && !salvo.targetRoster}
  <EmptyState>No list to hand? Pick units directly in the Attacker and Target panes.</EmptyState>
{/if}

<style>
  .field-label {
    display: block;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text);
  }
  .field-label .dim { font-weight: 400; }
  .field-hint {
    margin: 2px 0 var(--space-2);
    font-size: var(--text-xs);
  }
  textarea + :global(.row) { margin-top: var(--space-2); }
  .trials {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: 12px;
  }
  .trials code {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
</style>
