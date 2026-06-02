<script lang="ts">
  import type { SecondaryCard } from "@alpaca-software/40kdc-data";

  let {
    hand,
    available,
    activeId,
    canDraw,
    onDraw,
    onAdd,
    onSelect,
    onDiscard,
  }: {
    hand: SecondaryCard[];
    available: SecondaryCard[];
    activeId: string | null;
    canDraw: boolean;
    onDraw: () => void;
    onAdd: (id: string) => void;
    onSelect: (id: string) => void;
    onDiscard: (id: string) => void;
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
        class="focus-ring max-w-[10rem] bg-panel border border-border rounded px-2 py-1 text-xs text-text-muted hover:border-accent disabled:opacity-40"
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
            title="Discard"
            onclick={() => onDiscard(card.id)}>×</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</div>
