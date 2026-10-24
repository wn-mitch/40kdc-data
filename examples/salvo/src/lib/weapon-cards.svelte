<script lang="ts">
  // The output pane's phone view (below 640px): one stacked card per weapon line plus the combined
  // card, headline damage and kills always visible, the full pipeline and buff breakdown behind a
  // per-card toggle (the table's hover popover has no touch equivalent).
  import type { Snippet } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import type { AttributedStage, BuffSource } from "@alpaca-software/40kdc-data";

  import type { LineResult } from "./output-model.js";
  import { STAGE_COLUMNS, fmt, fmtSigned, srcKey, stageOf } from "./projection-model.js";

  let {
    lines,
    aggregate,
    included,
    toggleLine,
    carried,
    setCarried,
    labelForSource,
    usage,
  }: {
    lines: LineResult[];
    aggregate: AttributedStage[];
    included: (id: string) => boolean;
    toggleLine: (id: string) => void;
    carried: (line: LineResult) => number;
    setCarried: (line: LineResult, n: number) => void;
    labelForSource: (source: BuffSource) => string;
    usage: Snippet<[LineResult]>;
  } = $props();

  const expandedCards = new SvelteSet<string>();
  function toggleCard(id: string): void {
    if (expandedCards.has(id)) expandedCards.delete(id);
    else expandedCards.add(id);
  }
  const COMBINED_CARD = "__combined__";
</script>

{#snippet stageBreakdown(s: AttributedStage)}
  <div class="bk">
    <span class="bk-row bk-baseline"><span>baseline</span><span class="num">{fmt(s.baseline)}</span></span>
    {#each s.lifts as l (srcKey(l.source))}
      <span class="bk-row"><span>{labelForSource(l.source)}</span><span class="num delta">{fmtSigned(l.delta)}</span></span>
    {/each}
    {#if s.residual}
      <span class="bk-row overlap"><span>overlap (capped)</span><span class="num delta">{fmtSigned(s.residual)}</span></span>
    {/if}
    {#if s.intrinsics.length}
      <span class="bk-intrinsics">weapon: {s.intrinsics.join(", ")}</span>
    {/if}
  </div>
{/snippet}

{#snippet cardDetail(stages: AttributedStage[], id: string)}
  <div
    class="wcard-detail"
    id="wcard-detail-{id}"
    role="region"
    transition:slide={{ duration: 200, easing: quintOut }}
  >
    {#each STAGE_COLUMNS as col (col.name)}
      {@const s = stageOf(stages, col.name)}
      <div class="wcard-stage">
        <span class="stage-label">{col.full}</span>
        <span class="stage-value num">{s ? fmt(s.expected) : "—"}</span>
      </div>
      {#if s && (s.lifts.length > 0 || s.residual !== 0 || s.intrinsics.length > 0)}
        {@render stageBreakdown(s)}
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet headline(stages: AttributedStage[])}
  <div class="wcard-headline">
    <span class="metric">
      <span class="metric-label" title="Expected damage after feel-no-pain">damage</span>
      <span class="metric-num">{fmt(stageOf(stages, "after-fnp")?.expected ?? NaN)}</span>
    </span>
    <span class="metric">
      <span class="metric-label" title="Expected models killed">killed</span>
      <span class="metric-num">{fmt(stageOf(stages, "models-killed")?.expected ?? NaN)}</span>
    </span>
  </div>
{/snippet}

<div class="proj-cards">
  <article class="wcard combined">
    <div class="wcard-top">
      <button
        class="wcard-toggle"
        aria-expanded={expandedCards.has(COMBINED_CARD)}
        aria-controls="wcard-detail-{COMBINED_CARD}"
        onclick={() => toggleCard(COMBINED_CARD)}
      >
        <span class="chev" class:open={expandedCards.has(COMBINED_CARD)} aria-hidden="true"></span>
        <span class="wcard-name">Combined</span>
      </button>
    </div>
    {@render headline(aggregate)}
    {#if expandedCards.has(COMBINED_CARD)}
      {@render cardDetail(aggregate, COMBINED_CARD)}
    {/if}
  </article>

  {#each lines as r (r.id)}
    <article class="wcard" class:excluded={!included(r.id)}>
      <div class="wcard-top">
        <input
          type="checkbox"
          checked={included(r.id)}
          onchange={() => toggleLine(r.id)}
          aria-label={`Include ${r.label} in combined total`}
        />
        <button
          class="wcard-toggle"
          aria-expanded={expandedCards.has(r.id)}
          aria-controls="wcard-detail-{r.id}"
          onclick={() => toggleCard(r.id)}
        >
          <span class="chev" class:open={expandedCards.has(r.id)} aria-hidden="true"></span>
          <span class="wcard-name">{r.label}</span>
        </button>
        <label class="wcard-models">
          <span>models</span>
          <input
            type="number"
            min="0"
            class="models-input"
            value={carried(r)}
            oninput={(e) => setCarried(r, Number((e.currentTarget as HTMLInputElement).value))}
            aria-label={`Models carrying ${r.label}`}
          />
          {@render usage(r)}
        </label>
      </div>
      {#if r.error}
        <p class="error">{r.error}</p>
      {:else}
        {@render headline(r.attributed)}
        {#if expandedCards.has(r.id)}
          {@render cardDetail(r.attributed, r.id)}
        {/if}
      {/if}
    </article>
  {/each}
</div>

<style>
  .proj-cards { display: none; }
  @media (max-width: 640px) {
    .proj-cards {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
  }

  .wcard {
    background: var(--panel-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }
  .wcard.excluded > :not(.wcard-top),
  .wcard.excluded .wcard-toggle { opacity: 0.45; }
  .wcard.combined { border-color: var(--accent-dim); }
  .wcard.combined .metric-num { color: var(--accent); }

  .wcard-top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
  }
  .wcard-top input[type="checkbox"] { cursor: pointer; flex: 0 0 auto; }
  .wcard-toggle {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    padding: var(--space-1) 0;
    text-align: left;
    font-size: var(--text-sm);
    color: var(--text);
  }
  .wcard-toggle:hover { border: none; color: var(--accent); }
  .wcard-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: rotate(-45deg);
    transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
    margin-left: 2px;
  }
  .chev.open { transform: rotate(45deg); border-color: var(--text); }
  .wcard-models {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--muted);
    font-size: var(--text-2xs);
  }
  .models-input {
    width: 52px;
    text-align: right;
    font-family: var(--font-mono);
  }

  .wcard-headline {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-1) 0 var(--space-1) calc(7px + 2px + var(--space-2));
  }
  .metric {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .metric-label {
    font-family: var(--font-heading);
    font-size: var(--text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--muted);
  }
  .metric-num {
    font-family: var(--font-mono);
    font-size: var(--text-md);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .wcard-detail {
    margin-top: var(--space-1);
    padding: var(--space-2) 0 var(--space-1) calc(7px + 2px + var(--space-2));
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .wcard-stage {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }
  .stage-label { color: var(--muted); }
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .bk {
    margin: 1px 0 var(--space-1);
    padding-left: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: var(--text-2xs);
    border-left: 1px solid var(--border-subtle);
  }
  .bk-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .bk-baseline { color: var(--dim); }
  .bk-row.overlap { color: var(--dim); font-style: italic; }
  .bk .delta { color: var(--accent); }
  .bk-intrinsics { color: var(--dim); }
</style>
