<script lang="ts">
  import type { ForceDispositionId } from "@alpaca-software/40kdc-data";
  import {
    DISPOSITIONS,
    DISPOSITION_LABELS,
    missionFor,
    scoringCardFor,
  } from "./lib/data.js";
  import MissionCard from "./lib/MissionCard.svelte";

  // Relative path back up to the docs-site landing page that wraps the
  // examples (./examples/<name>/ → ./). Resolves correctly on the deployed
  // GitHub Pages site regardless of the TOOLLET_BASE prefix.
  const HOME_URL = "../../";
  const REPO_URL =
    "https://github.com/tabletop-developer-consortium/40kdc-data";
  const PACKAGE_URL =
    "https://www.npmjs.com/package/@alpaca-software/40kdc-data";
  const PUBLISHER_URL = "https://alpacasoft.dev";

  // Two independent picks, set by clicking a row header (you) and a column
  // header (your opponent). Clicking the active one again clears it.
  let you = $state<ForceDispositionId | null>(null);
  let opp = $state<ForceDispositionId | null>(null);

  const ready = $derived(you !== null && opp !== null);
  const isMirror = $derived(you !== null && you === opp);

  // The asymmetric pair: your mission for (you, opp); your opponent reads their
  // own card, so theirs is (opp, you). They coincide on the diagonal.
  const yourMission = $derived(ready ? missionFor(you!, opp!) : undefined);
  const oppMission = $derived(ready ? missionFor(opp!, you!) : undefined);
  const yourCard = $derived(yourMission ? scoringCardFor(yourMission.id) : undefined);
  const oppCard = $derived(oppMission ? scoringCardFor(oppMission.id) : undefined);

  function pickYou(d: ForceDispositionId): void {
    you = you === d ? null : d;
  }
  function pickOpp(d: ForceDispositionId): void {
    opp = opp === d ? null : d;
  }
  // A cell is your selection at (you, opp); the opponent's reciprocal is (opp, you).
  function cellState(row: ForceDispositionId, col: ForceDispositionId): "your" | "opp" | null {
    if (!ready) return null;
    if (row === you && col === opp) return "your";
    if (row === opp && col === you) return "opp";
    return null;
  }
</script>

<div class="app">
  <header class="app-header">
    <a class="brand" href={REPO_URL} target="_blank" rel="noreferrer noopener">
      <h1>Mission Matrix</h1>
      <span class="tag">11e Force Disposition matchups</span>
    </a>
    <nav class="app-header-links">
      <a class="home" href={HOME_URL} aria-label="Back to 40kdc-data examples">
        ← 40kdc-data
      </a>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer noopener"
        aria-label="GitHub repository"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
      </a>
      <a class="pkg" href={PACKAGE_URL} target="_blank" rel="noreferrer noopener">
        <code>@alpaca-software/40kdc-data</code>
      </a>
      <a
        class="publisher"
        href={PUBLISHER_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        alpacasoft.dev
      </a>
    </nav>
  </header>

  <main class="content">
    <p class="intro">
      Click <strong>your disposition</strong> (a row) and your
      <strong>opponent's</strong> (a column). Two cells light up: your mission
      (solid) and your opponent's equivalent (dimmed — that wasn't your pick).
      The primaries are asymmetric; each player reads their own card.
    </p>

    <div
      class="matrix"
      role="grid"
      aria-label="Force Disposition matchup matrix"
      style="--cols: {DISPOSITIONS.length}"
    >
      <div class="corner" aria-hidden="true">
        <span class="axis-you">You ▼</span>
        <span class="axis-opp">Opp ▶</span>
      </div>
      {#each DISPOSITIONS as col (col)}
        <button
          type="button"
          class="col-head"
          class:selected={opp === col}
          aria-pressed={opp === col}
          onclick={() => pickOpp(col)}
        >
          {DISPOSITION_LABELS[col]}
        </button>
      {/each}

      {#each DISPOSITIONS as row (row)}
        <button
          type="button"
          class="row-head"
          class:selected={you === row}
          aria-pressed={you === row}
          onclick={() => pickYou(row)}
        >
          {DISPOSITION_LABELS[row]}
        </button>
        {#each DISPOSITIONS as col (col)}
          {@const m = missionFor(row, col)}
          {@const state = cellState(row, col)}
          <div
            class="cell"
            class:your-cell={state === "your"}
            class:opp-cell={state === "opp"}
          >
            {#if state === "your"}<span class="cell-tag">{isMirror ? "YOU · OPP" : "YOU"}</span>{/if}
            {#if state === "opp"}<span class="cell-tag">OPP</span>{/if}
            <span class="cell-name">{m?.name ?? "—"}</span>
          </div>
        {/each}
      {/each}
    </div>

    <div class="selectors" role="group" aria-label="Pick dispositions">
      <div class="selector-group">
        <span class="section-label">You</span>
        <div class="pill-row">
          {#each DISPOSITIONS as d (d)}
            <button
              type="button"
              class="pill"
              class:selected={you === d}
              aria-pressed={you === d}
              onclick={() => pickYou(d)}
            >
              {DISPOSITION_LABELS[d]}
            </button>
          {/each}
        </div>
      </div>
      <div class="selector-group">
        <span class="section-label">Opponent</span>
        <div class="pill-row">
          {#each DISPOSITIONS as d (d)}
            <button
              type="button"
              class="pill"
              class:selected={opp === d}
              aria-pressed={opp === d}
              onclick={() => pickOpp(d)}
            >
              {DISPOSITION_LABELS[d]}
            </button>
          {/each}
        </div>
      </div>
    </div>

    {#if ready}
      <section class="readout">
        {#if isMirror}
          <p class="dim mirror-note">
            Mirror match — both players play the same mission.
          </p>
        {/if}
        <div class="grid-2">
          <div class="pane projection">
            <div class="readout-head">
              <span class="section-label">Your mission</span>
              <span class="chip accent">{DISPOSITION_LABELS[you!]}</span>
              <span class="vs">vs</span>
              <span class="chip">{DISPOSITION_LABELS[opp!]}</span>
            </div>
            <MissionCard mission={yourMission} card={yourCard} />
          </div>
          <div class="pane projection">
            <div class="readout-head">
              <span class="section-label">Opponent's mission</span>
              <span class="chip accent">{DISPOSITION_LABELS[opp!]}</span>
              <span class="vs">vs</span>
              <span class="chip">{DISPOSITION_LABELS[you!]}</span>
            </div>
            <MissionCard mission={oppMission} card={oppCard} />
          </div>
        </div>
      </section>
    {:else}
      <div class="empty-state">
        Pick your disposition (a row) and your opponent's (a column) to reveal
        both missions.
      </div>
    {/if}
  </main>

  <footer class="app-footer">
    <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
      github.com/tabletop-developer-consortium/40kdc-data
    </a>
    <span class="dot" aria-hidden="true">·</span>
    <span class="muted">
      powered by
      <a href={PACKAGE_URL} target="_blank" rel="noreferrer noopener"
        ><code>@alpaca-software/40kdc-data</code></a
      >
    </span>
  </footer>
</div>
