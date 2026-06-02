<script lang="ts">
  import type {
    SecondaryCard,
    ScoringAward,
    ScoringMode,
    AssertedAward,
  } from "@alpaca-software/40kdc-data";
  import {
    awardsForApproach,
    scoreAward,
    scoreCap,
    scoreSecondaryEvent,
    describeAward,
  } from "@alpaca-software/40kdc-data";

  let {
    card,
    approach,
    onScore,
  }: {
    card: SecondaryCard | undefined;
    approach: ScoringMode;
    // Emits the asserted awards; the parent banks the VP and discards the card.
    onScore: (asserted: AssertedAward[]) => void;
  } = $props();

  const awards = $derived(card ? awardsForApproach(card, approach) : []);
  const cap = $derived(card ? scoreCap(card, approach) : 0);
  const capLabel = $derived(cap === Infinity ? "∞" : String(cap));

  // Per-award selection: whether it's ticked, and (for vp_per) how many instances.
  let on = $state<Record<number, boolean>>({});
  let counts = $state<Record<number, number>>({});
  function countFor(i: number, a: ScoringAward): number {
    return counts[i] ?? a.per_max ?? 1;
  }
  function setCount(i: number, a: ScoringAward, v: number): void {
    counts = { ...counts, [i]: Math.max(1, Math.min(a.per_max ?? 99, v)) };
  }
  function toggle(i: number): void {
    on = { ...on, [i]: !on[i] };
  }

  const asserted = $derived<AssertedAward[]>(
    awards.flatMap((award, i) => (on[i] ? [{ award, count: countFor(i, award) }] : [])),
  );
  const preview = $derived(
    card ? scoreSecondaryEvent(asserted, card, approach) : 0,
  );

  function commit(): void {
    if (!card || asserted.length === 0) return;
    onScore(asserted);
    on = {};
    counts = {};
  }
</script>

{#if card}
  <div class="flex flex-col gap-3">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="font-heading text-base font-bold uppercase tracking-wide text-accent m-0">
        {card.name}
      </h3>
      <span class="font-mono text-[11px] text-text-dim whitespace-nowrap" title="Per-score cap">
        max {capLabel} VP
      </span>
    </div>

    {#if card.text}
      <p class="m-0 text-xs leading-snug text-text-muted">{card.text}</p>
    {/if}

    <ul class="flex flex-col gap-1.5 m-0 p-0 list-none">
      {#each awards as a, i (i)}
        {@const ticked = !!on[i]}
        <li
          class="flex items-center gap-2 rounded border px-2 py-1.5 transition-colors {ticked
            ? 'bg-accent-dim border-accent'
            : 'bg-panel-surface border-panel-border'}"
        >
          <button
            type="button"
            class="focus-ring shrink-0 w-5 h-5 rounded-sm border flex items-center justify-center text-[11px] {ticked
              ? 'bg-accent text-accent-foreground border-accent'
              : 'border-border text-transparent'}"
            role="checkbox"
            aria-checked={ticked}
            aria-label="toggle award"
            onclick={() => toggle(i)}>✓</button
          >
          <div class="min-w-0 flex-1">
            <div class="text-xs leading-snug text-text">{describeAward(a)}</div>
            {#if a.exclusive_group}
              <div class="font-heading text-[10px] uppercase tracking-wide text-text-dim">tier — score one</div>
            {/if}
          </div>

          {#if a.vp_per != null}
            <div class="flex items-center gap-1" class:opacity-40={!ticked}>
              <button
                type="button"
                class="focus-ring w-6 h-6 rounded bg-panel border border-border text-text-muted hover:border-accent hover:text-accent"
                disabled={!ticked}
                aria-label="decrease count"
                onclick={() => setCount(i, a, countFor(i, a) - 1)}>−</button
              >
              <span class="font-mono tabular-nums text-sm w-5 text-center">{countFor(i, a)}</span>
              <button
                type="button"
                class="focus-ring w-6 h-6 rounded bg-panel border border-border text-text-muted hover:border-accent hover:text-accent"
                disabled={!ticked}
                aria-label="increase count"
                onclick={() => setCount(i, a, countFor(i, a) + 1)}>+</button
              >
            </div>
          {/if}

          <span class="font-mono tabular-nums text-sm w-8 text-right text-text-muted"
            >{scoreAward(a, countFor(i, a))}</span
          >
        </li>
      {/each}
    </ul>

    <button
      type="button"
      class="focus-ring font-heading text-xs font-bold uppercase tracking-wide rounded px-3 py-2 bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent"
      disabled={asserted.length === 0}
      onclick={commit}
    >
      Score {preview} VP &amp; discard
    </button>
  </div>
{:else}
  <div class="text-text-muted text-sm">Draw a secondary and tap it to score it here.</div>
{/if}
