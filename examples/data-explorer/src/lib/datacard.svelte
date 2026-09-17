<script lang="ts">
  import type { AbilityView, UnitView } from "@alpaca-software/40kdc-data";
  import UnitDatacard from "../../../_shared/UnitDatacard.svelte";
  import { explorer } from "./store.svelte.js";
  import { notes } from "./notes.svelte.js";

  let { unit }: { unit: UnitView } = $props();
</script>

{#snippet abilityActions(ability: AbilityView, description: string)}
  <button
    class="icon-btn"
    class:flagged={notes.isFlagged(ability.id)}
    title={notes.isFlagged(ability.id) ? "Flagged for review" : "Flag for review"}
    onclick={() => notes.toggleFlag(ability.id, description)}
  >{notes.isFlagged(ability.id) ? "⚑" : "⚐"}</button>
  <button class="icon-btn" title="Inspect DSL roundtrip" onclick={() => explorer.inspect(ability.id)}>QA</button>
{/snippet}

<UnitDatacard {unit} {abilityActions} />
