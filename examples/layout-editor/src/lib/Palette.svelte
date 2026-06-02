<script lang="ts">
  import Thumbnail from "./Thumbnail.svelte";
  import type { TerrainTemplate } from "@alpaca-software/40kdc-data";

  interface Props {
    areas: TerrainTemplate[];
    features: TerrainTemplate[];
    onadd: (t: TerrainTemplate) => void;
  }
  let { areas, features, onadd }: Props = $props();
</script>

<div class="palette">
  <h2>Templates</h2>

  <h4>Areas</h4>
  <div class="grid">
    {#each areas as t (t.id)}
      <button class="card area" onclick={() => onadd(t)} title={t.name}>
        <Thumbnail template={t} />
        <span class="name">{t.name}</span>
      </button>
    {/each}
  </div>

  <h4>Features</h4>
  <div class="grid">
    {#each features as t (t.id)}
      <button class="card feature" onclick={() => onadd(t)} title={t.name}>
        <Thumbnail template={t} />
        <span class="name">{t.name}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .palette {
    display: flex;
    flex-direction: column;
  }
  h2 {
    font-family: "Barlow Condensed", sans-serif;
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  h4 {
    margin: 0.8rem 0 0.4rem;
    color: var(--text-dim);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 0.5rem 0.35rem 0.4rem;
    background: var(--surface-2);
    border: 1px solid var(--rim);
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-dim);
    font: inherit;
    transition: border-color 120ms ease-out, background 120ms ease-out;
  }
  .card:hover {
    border-color: var(--accent);
    background: var(--accent-fill);
  }
  .card .name {
    font-size: 0.72rem;
    line-height: 1.1;
    text-align: center;
  }
  .card.feature .name {
    color: var(--piece-feature-stroke);
  }
  .card.area .name {
    color: var(--piece-area-stroke);
  }
</style>
