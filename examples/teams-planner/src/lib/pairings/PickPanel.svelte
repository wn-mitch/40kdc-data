<script lang="ts">
  import { ds } from "../dataset";
  import DispoPill from "../DispoPill.svelte";
  import type { SimPlayer } from "./types";

  /**
   * One secret-pick step: a prompt, selectable roster chips, and a confirm.
   * While the user deliberates, the CPU's matching pick already exists in the
   * module state — the parent renders this panel with a "ready" badge so the
   * simultaneity reads, but never the pick itself.
   */
  let {
    title,
    prompt,
    options,
    count,
    confirmLabel,
    onconfirm,
  }: {
    title: string;
    prompt: string;
    options: SimPlayer[];
    /** How many players the step selects (1 = defender/accept, 2 = attackers). */
    count: number;
    confirmLabel: string;
    onconfirm: (ids: string[]) => void;
  } = $props();

  let picked = $state<string[]>([]);

  function toggle(id: string) {
    if (picked.includes(id)) {
      picked = picked.filter((p) => p !== id);
    } else {
      // At capacity, a new pick replaces the oldest so re-picking flows fast.
      picked = [...picked.slice(-(count - 1)), id];
    }
  }
</script>

<section class="rounded-md border border-panel-border bg-panel-surface p-3">
  <h3 class="font-heading text-sm font-bold uppercase tracking-wider text-text-muted">{title}</h3>
  <p class="mb-2 mt-1 text-sm text-text">{prompt}</p>
  <div class="flex flex-wrap gap-2">
    {#each options as p (p.id)}
      <button
        type="button"
        class="focus-ring flex items-center gap-2 rounded border px-2.5 py-1.5 text-sm
               {picked.includes(p.id)
                 ? 'border-accent bg-accent-dim text-text'
                 : 'border-border-strong bg-panel text-text-muted hover:border-accent'}"
        aria-pressed={picked.includes(p.id)}
        onclick={() => toggle(p.id)}
      >
        <span>{p.name}</span>
        <span class="text-[11px] text-text-dim">{ds.factions.get(p.factionId)?.name ?? p.factionId}</span>
        <DispoPill disposition={p.fd} tier="could" />
      </button>
    {/each}
  </div>
  <div class="mt-3 flex items-center gap-3">
    <button
      type="button"
      class="focus-ring rounded bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
      disabled={picked.length !== count}
      onclick={() => {
        onconfirm(picked);
        picked = [];
      }}
    >
      {confirmLabel}
    </button>
    <span class="text-[11px] uppercase tracking-wide text-text-dim">
      Opponent has chosen — reveal is simultaneous
    </span>
  </div>
</section>
