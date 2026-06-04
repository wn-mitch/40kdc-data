<script lang="ts">
  import type { SecondaryCard } from "@alpaca-software/40kdc-data";

  let {
    hand,
    available,
    activeId,
    discards,
    canDraw,
    onDraw,
    onAdd,
    onSelect,
    onDiscard,
    onRestore,
  }: {
    hand: SecondaryCard[];
    available: SecondaryCard[];
    activeId: string | null;
    /** Manually discarded (unscored) cards — out of the deck, restorable. */
    discards: SecondaryCard[];
    canDraw: boolean;
    onDraw: () => void;
    onAdd: (id: string) => void;
    onSelect: (id: string) => void;
    onDiscard: (id: string) => void;
    onRestore: (id: string) => void;
  } = $props();

  // Manual pick: choosing a card adds it, then the select resets to its prompt.
  function pick(e: Event): void {
    const sel = e.currentTarget as HTMLSelectElement;
    if (sel.value) {
      onAdd(sel.value);
      sel.value = "";
    }
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center justify-between gap-2">
    <span class="font-heading text-[11px] font-bold uppercase tracking-wider text-text-muted">
      Hand
    </span>
    <div class="flex items-center gap-2">
      <select
        class="focus-ring max-w-[10rem] bg-panel border border-border-strong rounded px-2 py-1 text-xs text-text-muted hover:border-accent disabled:opacity-40"
        disabled={available.length === 0}
        onchange={pick}
        aria-label="Add a specific secondary"
      >
        <option value="">Add card…</option>
        {#each available as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
      <button
        type="button"
        class="focus-ring font-heading text-[11px] font-bold uppercase tracking-wide rounded px-3 py-1 bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent"
        disabled={!canDraw}
        onclick={onDraw}>Draw</button
      >
    </div>
  </div>

  {#if hand.length === 0}
    <div class="rounded bg-panel-surface border border-panel-border px-3 py-3 text-center text-xs text-text-muted">
      No secondaries held. <span class="text-text">Draw</span> to deal one.
    </div>
  {:else}
    <ul class="flex flex-wrap gap-2 m-0 p-0 list-none">
      {#each hand as card (card.id)}
        {@const active = card.id === activeId}
        <li class="flex items-stretch rounded border overflow-hidden {active ? 'border-accent' : 'border-panel-border'}">
          <button
            type="button"
            class="focus-ring text-left px-2 py-1 transition-colors {active
              ? 'bg-accent-dim'
              : 'bg-panel-surface hover:bg-panel-hover'}"
            aria-pressed={active}
            onclick={() => onSelect(card.id)}
          >
            <span class="font-heading text-xs font-bold uppercase tracking-wide text-text">{card.name}</span>
          </button>
          <button
            type="button"
            class="focus-ring px-1.5 bg-panel-surface border-l border-panel-border text-text-dim hover:text-danger"
            aria-label="discard {card.name}"
            title="Discard (out of the deck for the rest of the game)"
            onclick={() => onDiscard(card.id)}>×</button
          >
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Discarded-without-scoring pile: out of the deck like a scored card, but
       restorable in case of a misclick. Collapsed; absent until non-empty. -->
  {#if discards.length > 0}
    <details class="group">
      <summary
        class="focus-ring list-none flex items-center gap-1 font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim hover:text-accent"
      >
        <span class="inline-block transition-transform group-open:rotate-90">▶</span>
        Discarded ({discards.length})
      </summary>
      <ul class="flex flex-wrap gap-1.5 m-0 mt-1.5 p-0 list-none">
        {#each discards as card (card.id)}
          <li class="flex items-center gap-1.5 rounded bg-panel border border-panel-border pl-2 pr-1 py-0.5">
            <span class="font-heading text-[10px] font-bold uppercase tracking-wide text-text-dim">{card.name}</span>
            <button
              type="button"
              class="focus-ring px-1 rounded-sm text-text-dim hover:text-accent leading-none"
              aria-label="Restore {card.name} to hand"
              title="Restore to hand"
              onclick={() => onRestore(card.id)}>↺</button
            >
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</div>
