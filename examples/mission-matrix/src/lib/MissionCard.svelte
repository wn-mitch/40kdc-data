<script lang="ts">
  import type { Mission, SecondaryCard } from "@alpaca-software/40kdc-data";
  import { describeScoringCard } from "@alpaca-software/40kdc-data";

  let { mission, card }: { mission: Mission | undefined; card: SecondaryCard | undefined } =
    $props();

  // The award lines come from the package's cross-impl translator — the same
  // strings the Rust crate produces and the conformance corpus pins.
  const awards = $derived(card ? describeScoringCard(card) : []);
</script>

{#if mission}
  <div>
    <h3 class="font-heading text-lg font-bold uppercase tracking-wide text-accent m-0 mb-2">
      {mission.name}
    </h3>
    <div class="flex gap-6 mb-3">
      <span class="flex flex-col">
        <span class="font-mono tabular-nums text-2xl leading-none">{mission.vp_per_game_cap}</span>
        <span class="mt-1 font-heading text-[11px] uppercase tracking-wide text-text-muted">VP / game</span>
      </span>
      <span class="flex flex-col">
        <span class="font-mono tabular-nums text-2xl leading-none">{mission.vp_per_round_cap}</span>
        <span class="mt-1 font-heading text-[11px] uppercase tracking-wide text-text-muted">VP / round</span>
      </span>
    </div>

    {#if card?.text}
      <p class="m-0 mb-3 text-sm leading-normal text-text-muted">{card.text}</p>
    {/if}

    {#if awards.length > 0}
      <div class="font-heading text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
        Scoring
      </div>
      <ul class="m-0 mb-1 pl-4 flex flex-col gap-1 list-disc marker:text-text-dim">
        {#each awards as line}
          <li class="text-xs leading-snug text-text">{line}</li>
        {/each}
      </ul>
    {/if}
  </div>
{:else}
  <div class="text-text-muted text-sm">No mission found for this pairing.</div>
{/if}
