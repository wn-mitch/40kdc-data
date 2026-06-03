<script lang="ts">
  import type { ScoringAward, AssertedAward } from "@alpaca-software/40kdc-data";
  import { scoreAward, scoreTurn, describeAward } from "@alpaca-software/40kdc-data";

  // A generic award-ticking scorer shared by the primary and secondary panels.
  // The caller supplies the awards (already filtered for the active approach),
  // the per-score `cap`, and what committing means — secondaries discard, the
  // primary writes the current round. Preview is the asserted total clamped to
  // `cap`, which is `scoreSecondaryEvent` / `scorePrimaryEvent` made generic.
  let {
    title,
    text = undefined,
    awards,
    cap,
    capLabel,
    commitLabel,
    emptyHint,
    onCommit,
    extraAction = undefined,
  }: {
    title: string;
    text?: string;
    awards: ScoringAward[];
    cap: number;
    capLabel: string;
    commitLabel: (vp: number) => string;
    emptyHint: string;
    onCommit: (asserted: AssertedAward[]) => void;
    extraAction?: { label: string; disabled?: boolean; onClick: () => void };
  } = $props();

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
  const preview = $derived(Math.min(scoreTurn(asserted), cap));

  function commit(): void {
    if (asserted.length === 0) return;
    onCommit(asserted);
    on = {};
    counts = {};
  }
</script>

{#if awards.length > 0}
  <div class="flex flex-col gap-3">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="font-heading text-base font-bold uppercase tracking-wide text-accent m-0">
        {title}
      </h3>
      <span class="font-mono text-[11px] text-text-dim whitespace-nowrap" title="Per-score cap">
        max {capLabel} VP
      </span>
    </div>

    {#if text}
      <p class="m-0 text-xs leading-snug text-text-muted">{text}</p>
    {/if}

    <ul class="flex flex-col gap-1.5 m-0 p-0 list-none">
      {#each awards as a, i (i)}
        {@const ticked = !!on[i]}
        <!-- The row-filling button is the checkbox; the count steppers are
             separate sibling controls so adjusting a count never toggles it. -->
        <li
          class="flex items-center gap-2 rounded border px-2 py-1.5 transition-colors {ticked
            ? 'bg-accent-dim border-accent'
            : 'bg-panel-surface border-panel-border'}"
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={ticked}
            class="focus-ring flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
            onclick={() => toggle(i)}
          >
            <span
              aria-hidden="true"
              class="shrink-0 w-5 h-5 rounded-sm border flex items-center justify-center text-[11px] {ticked
                ? 'bg-accent text-accent-foreground border-accent'
                : 'border-border text-transparent'}">✓</span
            >
            <span class="min-w-0 flex-1">
              <span class="block text-xs leading-snug text-text">{describeAward(a)}</span>
              {#if a.exclusive_group}
                <span class="block font-heading text-[10px] uppercase tracking-wide text-text-dim">tier — score one</span>
              {/if}
            </span>
          </button>

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

          <span class="font-mono tabular-nums text-sm w-8 text-right text-text-muted shrink-0"
            >{scoreAward(a, countFor(i, a))}</span
          >
        </li>
      {/each}
    </ul>

    <div class="flex items-center gap-2">
      {#if extraAction}
        <button
          type="button"
          class="focus-ring shrink-0 font-heading text-xs font-bold uppercase tracking-wide rounded border px-3 py-2.5 bg-panel text-text-muted border-border hover:border-danger hover:text-danger disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
          disabled={extraAction.disabled}
          onclick={extraAction.onClick}
        >
          {extraAction.label}
        </button>
      {/if}
      <button
        type="button"
        class="focus-ring flex-1 font-heading text-sm font-bold uppercase tracking-wide rounded px-3 py-2.5 shadow-md bg-accent text-accent-foreground hover:bg-accent-hover disabled:bg-panel disabled:text-text-muted disabled:border disabled:border-border disabled:shadow-none"
        disabled={asserted.length === 0}
        onclick={commit}
      >
        {commitLabel(preview)}
      </button>
    </div>
  </div>
{:else}
  <div class="text-text-muted text-sm">{emptyHint}</div>
{/if}
