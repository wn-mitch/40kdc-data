<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AbilityView, UnitView } from "@alpaca-software/40kdc-data";
  import { groupAbilities } from "./ability-groups.js";
  import { formatBaseSize } from "./unit-card.js";

  let {
    unit,
    abilityActions,
    abilityText,
    attachmentBodyguards = [],
  }: {
    unit: UnitView;
    abilityActions?: Snippet<[AbilityView, string]>;
    /** Runtime-only source text keyed by ability id. */
    abilityText?: Readonly<Record<string, string>>;
    attachmentBodyguards?: readonly { id: string; name: string }[];
  } = $props();

  const profiles = $derived(unit.raw.profiles);
  const ranged = $derived(unit.weapons.filter((weapon) => weapon.raw.type === "ranged"));
  const melee = $derived(unit.weapons.filter((weapon) => weapon.raw.type === "melee"));
  const groupedAbilities = $derived(groupAbilities(unit.abilities));
  const base = $derived(formatBaseSize(unit.raw.base_size_mm));
  const role = $derived(unit.raw.role ? unit.raw.role.replace(/-/g, " ") : null);

  function keywordLabel(
    name: string,
    parameters: Record<string, unknown> | undefined,
  ): string {
    const parameter = parameters ?? {};
    let label = name;
    if (typeof parameter.target_keyword === "string") {
      const keyword = parameter.target_keyword.replace(/-/g, " ");
      label += name.endsWith("-") ? keyword : ` ${keyword}`;
    }
    if (parameter.threshold != null) label += ` ${parameter.threshold}+`;
    if (parameter.value != null) label += ` ${parameter.value}`;
    return label;
  }

  function tierLabel(tier: {
    models: number;
    cost: number;
    unit_count_min?: number;
    unit_count_max?: number | null;
  }): string {
    return `${tier.models} ${tier.models === 1 ? "model" : "models"} · ${tier.cost} pts`;
  }

  function describe(ability: AbilityView): string {
    try {
      return ability.describe();
    } catch {
      return "";
    }
  }
</script>

<article class="datacard">
  <div class="dc-header">
    <div class="dc-title">
      <h1>{unit.name}</h1>
      <span class="dc-sub">
        {#if role}<span style="text-transform:capitalize">{role}</span>{/if}
        {#if role && unit.faction} · {/if}
        {#if unit.faction}{unit.faction.name}{/if}
        {#if base} · {base}{/if}
      </span>
    </div>
    {#if unit.raw.points?.length}
      <div class="dc-points">
        {#each unit.raw.points as tier}
          <span class="tier">{tierLabel(tier)}</span>
        {/each}
      </div>
    {/if}
  </div>

  {#each profiles as profile, index}
    <div class="statline">
      {#if profiles.length > 1}
        <span class="profile-name">{profile.name ?? `Profile ${index + 1}`}</span>
      {/if}
      {#each [["M", profile.M], ["T", profile.T], ["SV", `${profile.Sv}+`], ["W", profile.W], ["LD", `${profile.Ld}+`], ["OC", profile.OC]] as [key, value]}
        <span class="stat"><span class="k">{key}</span><span class="v">{value}</span></span>
      {/each}
      {#if profile.invuln_sv != null}
        <span class="stat invuln"><span class="k">INV</span><span class="v">{profile.invuln_sv}+</span></span>
      {/if}
    </div>
  {/each}

  {#if ranged.length}
    <section class="dc-section" aria-labelledby="ranged-weapons">
      <h2 id="ranged-weapons">Ranged Weapons</h2>
      <div class="weapon-scroll" role="region" aria-label="Ranged weapons table">
        <table class="weapons">
          <caption class="visually-hidden">Ranged weapons</caption>
          <thead><tr><th class="name">Weapon</th><th>Range</th><th>A</th><th>BS</th><th>S</th><th>AP</th><th>D</th></tr></thead>
          <tbody>
            {#each ranged as weapon}
              {#each weapon.raw.profiles as profile, profileIndex}
                <tr>
                  <td class="name">
                    {weapon.raw.profiles.length > 1 ? `${weapon.name} – ${profile.name}` : weapon.name}
                    {#if weapon.keywordsAt(profileIndex).length}
                      <div class="kw-chips">
                        {#each weapon.keywordsAt(profileIndex) as keyword}
                          <span class="chip">{keywordLabel(keyword.keyword.name, keyword.parameters)}</span>
                        {/each}
                      </div>
                    {/if}
                  </td>
                  <td>{profile.range === "Melee" || profile.range == null ? "—" : `${profile.range}"`}</td>
                  <td>{profile.stats.A}</td>
                  <td>{profile.stats.BS != null ? `${profile.stats.BS}+` : "—"}</td>
                  <td>{profile.stats.S}</td><td>{profile.stats.AP}</td><td>{profile.stats.D}</td>
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  {#if melee.length}
    <section class="dc-section" aria-labelledby="melee-weapons">
      <h2 id="melee-weapons">Melee Weapons</h2>
      <div class="weapon-scroll" role="region" aria-label="Melee weapons table">
        <table class="weapons">
          <caption class="visually-hidden">Melee weapons</caption>
          <thead><tr><th class="name">Weapon</th><th>Range</th><th>A</th><th>WS</th><th>S</th><th>AP</th><th>D</th></tr></thead>
          <tbody>
            {#each melee as weapon}
              {#each weapon.raw.profiles as profile, profileIndex}
                <tr>
                  <td class="name">
                    {weapon.raw.profiles.length > 1 ? `${weapon.name} – ${profile.name}` : weapon.name}
                    {#if weapon.keywordsAt(profileIndex).length}
                      <div class="kw-chips">
                        {#each weapon.keywordsAt(profileIndex) as keyword}
                          <span class="chip">{keywordLabel(keyword.keyword.name, keyword.parameters)}</span>
                        {/each}
                      </div>
                    {/if}
                  </td>
                  <td>Melee</td><td>{profile.stats.A}</td>
                  <td>{profile.stats.WS != null ? `${profile.stats.WS}+` : "—"}</td>
                  <td>{profile.stats.S}</td><td>{profile.stats.AP}</td><td>{profile.stats.D}</td>
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  {#each groupedAbilities as group}
    <section class="dc-section">
      <h2>{group.label} Abilities</h2>
      <div class="dc-abilities">
        {#each group.abilities as ability (ability.id)}
          {@const description = abilityText?.[ability.id] || describe(ability)}
          <div class="dc-ability">
            <div class="body">
              <div class="ab-name">{ability.name}</div>
              {#if description}<div class="ab-desc">{description}</div>{/if}
            </div>
            {#if abilityActions}
              <div class="ab-actions">{@render abilityActions(ability, description)}</div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/each}

  {#if attachmentBodyguards.length}
    <div class="dc-keywords"><div class="kw-line"><b>Can lead</b>{attachmentBodyguards.map((unit) => unit.name).join(", ")}</div></div>
  {/if}

  <div class="dc-keywords">
    {#if unit.raw.keywords?.length}
      <div class="kw-line"><b>Keywords</b>{unit.raw.keywords.join(", ")}</div>
    {/if}
    {#if unit.raw.faction_keywords?.length}
      <div class="kw-line"><b>Faction</b>{unit.raw.faction_keywords.join(", ")}</div>
    {/if}
  </div>
</article>
