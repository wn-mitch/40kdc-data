<script lang="ts">
  import { salvo } from "./store.svelte.js";
  import { withConditionFact, type NeedToggle } from "./scenario.js";

  let { toggles }: { toggles: NeedToggle[] } = $props();

  /** "" unset, "yes" or "no": the declared answer under the toggle's key. */
  function answer(key: string): string {
    const value = salvo.scenario.conditionFacts?.[key];
    return value === undefined ? "" : value ? "yes" : "no";
  }

  function setAnswer(key: string, choice: string): void {
    salvo.scenario = withConditionFact(salvo.scenario, key, choice === "" ? undefined : choice === "yes");
  }
</script>

{#if toggles.length > 0}
  <div class="section-label">Needs</div>
  <p class="hint dim">These abilities depend on facts Salvo can't work out. Answer them to apply or rule out the ability.</p>
  <div class="ability-list">
    {#each toggles as toggle, i (toggle.key)}
      <div class="ability-row need" class:active={answer(toggle.key) !== ""}>
        <label class="name" for="need-{i}">
          {toggle.label}
          <span class="dim need-from">{toggle.abilities.join(", ")}</span>
        </label>
        <select
          id="need-{i}"
          value={answer(toggle.key)}
          onchange={(e) => setAnswer(toggle.key, (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">Unset</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
        <span class="chip manual">{toggle.side === "target" ? "defender" : "attacker"}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .need {
    align-items: center;
  }
  .need-from {
    display: block;
    font-size: 0.85em;
  }
</style>
