<script lang="ts">
  import { salvo } from "./store.svelte.js";
  import { momentLabel } from "./scenario.js";
  import type { MortalSourceChoice } from "./output-model.js";

  let { sources, error }: { sources: MortalSourceChoice[]; error?: string } = $props();

  const active = $derived(new Set(salvo.mortalSourcesActive));

  function toggle(key: string): void {
    salvo.mortalSourcesActive = active.has(key)
      ? salvo.mortalSourcesActive.filter((item) => item !== key)
      : [...salvo.mortalSourcesActive, key];
  }
</script>

{#if error}
  <p class="error" role="alert">Mortal wounds could not be read: {error}</p>
{:else if sources.length > 0}
  <div class="section-label">Mortal wounds</div>
  <p class="hint dim">Abilities that inflict mortal wounds outside the attack. Tick the ones that happen to count them in the total.</p>
  <div class="ability-list">
    {#each sources as source (source.key)}
      <label class="ability-row" class:active={active.has(source.key)}>
        <input type="checkbox" checked={active.has(source.key)} onchange={() => toggle(source.key)} />
        <span class="name">
          {source.label}
          <small>· {momentLabel(source.moment)} · {source.expected.toFixed(2)} expected{source.cp !== undefined ? ` · ${source.cp} CP` : ""}</small>
        </span>
        <span class="chip manual">mortal</span>
      </label>
    {/each}
  </div>
{/if}
