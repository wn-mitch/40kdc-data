<script lang="ts">
  import { salvo } from "./store.svelte.js";
  import {
    CONTROLLERS,
    STATES,
    STRENGTHS,
    parseDesignations,
    type Controller,
    type Scenario,
    type State,
    type Strength,
  } from "./scenario.js";

  type Side = "attacker" | "target";

  /** Set one field; `undefined` returns it to unset. */
  function set<K extends keyof Scenario>(key: K, value: Scenario[K]): void {
    const next = { ...salvo.scenario };
    if (value === undefined) delete next[key];
    else next[key] = value;
    salvo.scenario = next;
  }

  const designationsKey = (side: Side): "attackerDesignations" | "targetDesignations" =>
    side === "attacker" ? "attackerDesignations" : "targetDesignations";
  const statesKey = (side: Side): "attackerStates" | "targetStates" => (side === "attacker" ? "attackerStates" : "targetStates");
  const objectivesKey = (side: Side): "attackerObjectives" | "targetObjectives" =>
    side === "attacker" ? "attackerObjectives" : "targetObjectives";

  function toggleState(side: Side, state: State, on: boolean): void {
    const current = salvo.scenario[statesKey(side)] ?? [];
    set(statesKey(side), on ? [...current, state] : current.filter((item) => item !== state));
  }

  /** "" unset, "none" within no objective, else within one controlled by that player. */
  function objectiveChoice(side: Side): string {
    const objectives = salvo.scenario[objectivesKey(side)];
    if (objectives === undefined) return "";
    return objectives[0]?.controller ?? "none";
  }
  function setObjective(side: Side, choice: string): void {
    set(objectivesKey(side), choice === "" ? undefined : choice === "none" ? [] : [{ controller: choice as Controller }]);
  }

  const optional = (value: string) => (value === "" ? undefined : value);
</script>

<p class="hint dim">Unset facts leave the abilities that read them unresolved. A declared list is complete.</p>

<div class="row">
  <label for="sc-round">Battle round</label>
  <select
    id="sc-round"
    value={salvo.scenario.battleRound ?? ""}
    onchange={(e) => set("battleRound", optional((e.currentTarget as HTMLSelectElement).value) === undefined ? undefined : Number((e.currentTarget as HTMLSelectElement).value))}
  >
    <option value="">— unset —</option>
    {#each [1, 2, 3, 4, 5] as round (round)}<option value={round}>{round}</option>{/each}
  </select>
</div>

<div class="row">
  <label for="sc-turn">Turn</label>
  <select
    id="sc-turn"
    value={salvo.scenario.attackerTurn === undefined ? "" : String(salvo.scenario.attackerTurn)}
    onchange={(e) => {
      const value = (e.currentTarget as HTMLSelectElement).value;
      set("attackerTurn", value === "" ? undefined : value === "true");
    }}
  >
    <option value="">— unset —</option>
    <option value="true">The attacker's turn</option>
    <option value="false">The defender's turn</option>
  </select>
</div>

<div class="row">
  <label for="sc-closest">Closest target</label>
  <select
    id="sc-closest"
    value={salvo.scenario.targetClosest === undefined ? "" : String(salvo.scenario.targetClosest)}
    onchange={(e) => {
      const value = (e.currentTarget as HTMLSelectElement).value;
      set("targetClosest", value === "" ? undefined : value === "true");
    }}
  >
    <option value="">— unset —</option>
    <option value="true">The target is the closest eligible target</option>
    <option value="false">Another eligible target is closer</option>
  </select>
</div>

{#each [["attacker", "Attacker"], ["target", "Target"]] as const as [side, title] (side)}
  <fieldset class="side">
    <legend>{title}</legend>
    <div class="row">
      <label for="sc-{side}-strength">Strength</label>
      <select
        id="sc-{side}-strength"
        value={salvo.scenario[side === "attacker" ? "attackerStrength" : "targetStrength"] ?? ""}
        onchange={(e) => set(side === "attacker" ? "attackerStrength" : "targetStrength", optional((e.currentTarget as HTMLSelectElement).value) as Strength | undefined)}
      >
        <option value="">— unset —</option>
        {#each STRENGTHS as strength (strength.value)}<option value={strength.value}>{strength.label}</option>{/each}
      </select>
    </div>

    <div class="row">
      <label>
        <input
          type="checkbox"
          checked={salvo.scenario[statesKey(side)] !== undefined}
          onchange={(e) => set(statesKey(side), (e.currentTarget as HTMLInputElement).checked ? [] : undefined)}
        />
        States known
      </label>
      {#if salvo.scenario[statesKey(side)] !== undefined}
        {#each STATES as state (state.value)}
          <label class="inline">
            <input
              type="checkbox"
              checked={salvo.scenario[statesKey(side)]?.includes(state.value)}
              onchange={(e) => toggleState(side, state.value, (e.currentTarget as HTMLInputElement).checked)}
            />
            {state.label}
          </label>
        {/each}
      {/if}
    </div>

    <div class="row">
      <label>
        <input
          type="checkbox"
          checked={salvo.scenario[designationsKey(side)] !== undefined}
          onchange={(e) => set(designationsKey(side), (e.currentTarget as HTMLInputElement).checked ? [] : undefined)}
        />
        Designations known
      </label>
      {#if salvo.scenario[designationsKey(side)] !== undefined}
        <input
          class="grow"
          placeholder="e.g. Spotted, Afflicted, focus-of-hatred, warlord"
          value={(salvo.scenario[designationsKey(side)] ?? []).join(", ")}
          onchange={(e) => set(designationsKey(side), parseDesignations((e.currentTarget as HTMLInputElement).value))}
          aria-label="{title} designations"
        />
      {/if}
    </div>

    <div class="row">
      <label for="sc-{side}-objective">Objective</label>
      <select
        id="sc-{side}-objective"
        value={objectiveChoice(side)}
        onchange={(e) => setObjective(side, (e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="">— unset —</option>
        <option value="none">Not within range of an objective</option>
        {#each CONTROLLERS as controller (controller.value)}
          <option value={controller.value}>Within range of one controlled by {controller.label}</option>
        {/each}
      </select>
    </div>
  </fieldset>
{/each}

<style>
  .side {
    min-width: 0;
    border: 1px solid var(--border, currentColor);
    border-radius: var(--radius-sm, 4px);
    padding: var(--space-2);
    margin: var(--space-2) 0;
  }
  .inline {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    margin-right: var(--space-2);
  }
  .hint {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
  }
</style>
