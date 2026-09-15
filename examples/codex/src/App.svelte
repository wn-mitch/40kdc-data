<script lang="ts">
  import { onMount } from "svelte";
  import { dataset, type Enhancement, type Stratagem } from "@alpaca-software/40kdc-data";
  import AppFooter from "../../_shared/AppFooter.svelte";
  import AppHeader from "../../_shared/AppHeader.svelte";
  import UnitDatacard from "../../_shared/UnitDatacard.svelte";
  import { formatBaseSize } from "../../_shared/unit-card.js";
  import { resolveAbility } from "../../data-explorer/src/lib/detachments.js";
  import {
    DEFAULT_SOURCE,
    entryToText,
    loadFactionIndex,
    type StoreIndex,
  } from "../../data-explorer/src/lib/source-store.js";
  import { resolveCodexRoute } from "./lib/catalog.js";
  import { codexHref, parseCodexRoute } from "./lib/routes.js";
  import { sharePage, type ShareResult } from "./lib/share.js";

  const route = parseCodexRoute(window.location.pathname);
  const page = resolveCodexRoute(route);
  let factionFilter = $state("");
  let shareResult = $state<ShareResult | null>(null);
  let sharedUrl = $state("");
  let sourceIndex = $state<StoreIndex | null>(null);
  let sourceState = $state<"loading" | "loaded" | "unavailable">("loading");

  const abilityText = $derived.by(() => {
    if (!sourceIndex) return undefined;
    const textByAbility: Record<string, string> = {};
    for (const [abilityId, entry] of Object.entries(sourceIndex)) {
      const text = entryToText(entry);
      if (text) textByAbility[abilityId] = text;
    }
    return textByAbility;
  });

  onMount(() => {
    const factionId = page.kind === "faction" || page.kind === "unit" || page.kind === "detachment"
      ? page.faction.id
      : null;
    if (!factionId) {
      sourceState = "unavailable";
      return;
    }
    let active = true;
    void loadFactionIndex(DEFAULT_SOURCE, factionId, { force: true })
      .then(({ index }) => {
        if (!active) return;
        sourceIndex = index;
        sourceState = "loaded";
      })
      .catch(() => {
        if (active) sourceState = "unavailable";
      });
    return () => {
      active = false;
    };
  });

  const title =
    page.kind === "directory" || page.kind === "not-found"
      ? "40kdc Codex"
      : page.kind === "faction"
        ? `${page.faction.name} · 40kdc Codex`
        : page.kind === "unit"
          ? `${page.unit.name} · ${page.faction.name} · 40kdc Codex`
          : `${page.detachment.raw.name} · ${page.faction.name} · 40kdc Codex`;
  const description =
    page.kind === "directory"
      ? "A compact reader for 40kdc faction, unit, and detachment data."
      : page.kind === "not-found"
        ? "The requested 40kdc Codex entry was not found."
        : `Faction, unit, and detachment data for ${page.faction.name}.`;
  const filteredFactions = $derived(
    page.kind === "directory"
      ? page.factions.filter((faction) =>
          faction.name.toLocaleLowerCase().includes(factionFilter.trim().toLocaleLowerCase()),
        )
      : [],
  );

  function titleCase(value: string | null | undefined): string {
    if (!value) return "";
    return value
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function enhancementMeta(enhancement: Enhancement): string {
    const parts = [`${enhancement.cost} pts`];
    if (enhancement.points_provisional) parts.push("provisional");
    if (enhancement.upgrade_tag) parts.push(`upgrade ×${enhancement.max_targets ?? 1}`);
    return parts.join(" · ");
  }

  function stratagemMeta(stratagem: Stratagem): string {
    return [
      `${stratagem.cp_cost}CP`,
      stratagem.type ? titleCase(stratagem.type) : null,
      stratagem.phases?.length ? stratagem.phases.map(titleCase).join("/") : null,
      titleCase(stratagem.player_turn),
      titleCase(stratagem.timing),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function keywordLine(label: string, keywords: string[] | null | undefined): string | null {
    return keywords?.length ? `${label}: ${keywords.join(", ")}` : null;
  }

  function sourceDescription(abilityId: string, fallback: string): string {
    return entryToText(sourceIndex?.[abilityId]) || fallback;
  }

  async function shareCurrentPage(): Promise<void> {
    if (route.kind === "home" || route.kind === "not-found") return;
    sharedUrl = new URL(codexHref(route), window.location.origin).href;
    shareResult = await sharePage({ title, url: sharedUrl });
  }
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>

<div class="codex-app">
  <AppHeader title="40kdc Codex" tag="faction reader" appId="codex" />

  <main class="reader-shell">
    {#if page.kind === "directory"}
      <section class="directory" aria-labelledby="directory-title">
        <p class="eyebrow">Reader directory</p>
        <h1 id="directory-title">Factions</h1>
        <p class="intro">Linked unit cards and detachment summaries from the bundled community dataset.</p>
        <label class="faction-filter" for="faction-filter">
          <span>Find a faction</span>
          <input id="faction-filter" type="search" placeholder="Search factions" bind:value={factionFilter} />
        </label>
        {#if filteredFactions.length}
          <nav class="directory-list" aria-label="Faction directory">
            {#each filteredFactions as faction (faction.id)}
              <a href={codexHref({ kind: "faction", factionId: faction.id })}>
                <span>{faction.name}</span><span>{faction.units.length} units</span>
              </a>
            {/each}
          </nav>
        {:else}
          <p class="empty-state">No factions match “{factionFilter}”</p>
        {/if}
      </section>
    {:else if page.kind === "not-found"}
      <section class="not-found" aria-labelledby="not-found-title">
        <p class="eyebrow">Codex</p>
        <h1 id="not-found-title">Entry not found</h1>
        <p>The link does not identify a published faction, unit, or detachment.</p>
        <a class="button-link" href={codexHref({ kind: "home" })}>Browse factions</a>
      </section>
    {:else}
      <div class="reader-layout">
        <aside class="faction-rail" aria-label={`${page.faction.name} navigation`}>
          <a class="rail-faction" href={codexHref({ kind: "faction", factionId: page.faction.id })}>{page.faction.name}</a>
          <a href={codexHref({ kind: "faction", factionId: page.faction.id }) + "#faction-rule"}>Faction Rule</a>
          <a href={codexHref({ kind: "faction", factionId: page.faction.id }) + "#units"}>Units</a>
          <a href={codexHref({ kind: "faction", factionId: page.faction.id }) + "#detachments"}>Detachments</a>
          {#if page.kind === "detachment"}
            <a href="#enhancements">Enhancements</a>
            <a href="#stratagems">Stratagems</a>
          {/if}
        </aside>

        <article class="reader-content">
          <nav class="breadcrumbs" aria-label="Breadcrumb">
            <a href={codexHref({ kind: "home" })}>Factions</a><span aria-hidden="true">/</span>
            <a href={codexHref({ kind: "faction", factionId: page.faction.id })}>{page.faction.name}</a>
            {#if page.kind === "unit"}<span aria-hidden="true">/</span><span aria-current="page">{page.unit.name}</span>{/if}
            {#if page.kind === "detachment"}<span aria-hidden="true">/</span><span aria-current="page">{page.detachment.raw.name}</span>{/if}
          </nav>

          <details class="mobile-faction-nav">
            <summary>Browse faction</summary>
            <nav aria-label={`${page.faction.name} navigation`}>
              <a href={codexHref({ kind: "faction", factionId: page.faction.id })}>Faction overview</a>
              <a href={codexHref({ kind: "faction", factionId: page.faction.id }) + "#faction-rule"}>Faction Rule</a>
              <a href={codexHref({ kind: "faction", factionId: page.faction.id }) + "#units"}>Units</a>
              <a href={codexHref({ kind: "faction", factionId: page.faction.id }) + "#detachments"}>Detachments</a>
              {#if page.kind === "detachment"}
                <a href="#enhancements">Enhancements</a><a href="#stratagems">Stratagems</a>
              {/if}
            </nav>
          </details>
          {#if sourceState === "loading"}
            <p class="source-status">Loading ability text…</p>
          {:else if sourceState === "loaded"}
            <p class="source-status">Ability text loaded from 40kdc-abilities.</p>
          {:else}
            <p class="source-status">Ability text is unavailable; showing community summaries.</p>
          {/if}

          {#if page.kind === "faction"}
            <header class="page-heading">
              <div><p class="eyebrow">Faction reader</p><h1>{page.faction.name}</h1></div>
              <button class="share-button" onclick={shareCurrentPage}>Share</button>
            </header>
            {#if shareResult === "shared"}<p class="share-status" role="status">Shared</p>{/if}
            {#if shareResult === "copied"}<p class="share-status" role="status">Link copied</p>{/if}
            {#if shareResult === "unavailable"}
              <label class="manual-url"><span>Copy this link</span><input readonly value={sharedUrl} /></label>
            {/if}

            <section id="faction-rule" class="reader-section" aria-labelledby="faction-rule-title">
              <h2 id="faction-rule-title">Faction Rules</h2>
              {#if page.factionRules.length}
                {#each page.factionRules as factionRule (factionRule.id)}
                  {@const factionRuleText = sourceDescription(factionRule.id, factionRule.description)}
                  <div class="rule-card"><h3>{factionRule.name}</h3>{#if factionRuleText}<p>{factionRuleText}</p>{/if}</div>
                {/each}
              {:else}
                <p class="empty-state">No faction rules published for this faction.</p>
              {/if}
            </section>

            <section id="units" class="reader-section" aria-labelledby="units-title">
              <h2 id="units-title">Units</h2>
              {#if page.units.length}
                <div class="link-list">
                  {#each page.units as unit (unit.id)}
                    <a href={codexHref({ kind: "unit", factionId: page.faction.id, unitId: unit.id })}>
                      <span>{unit.name}</span>
                      <span>{[unit.raw.role ? titleCase(unit.raw.role) : null, formatBaseSize(unit.raw.base_size_mm)].filter(Boolean).join(" · ")}</span>
                    </a>
                  {/each}
                </div>
              {:else}<p class="empty-state">No units published for this faction.</p>{/if}
            </section>

            <section id="detachments" class="reader-section" aria-labelledby="detachments-title">
              <h2 id="detachments-title">Detachments</h2>
              {#if page.detachments.length}
                <div class="link-list">
                  {#each page.detachments as detachment (detachment.raw.id)}
                    <a href={codexHref({ kind: "detachment", factionId: page.faction.id, detachmentId: detachment.raw.id })}>
                      <span>{detachment.raw.name}</span>
                      <span>{detachment.enhancements.length} enhancements · {detachment.stratagems.length} stratagems</span>
                    </a>
                  {/each}
                </div>
              {:else}<p class="empty-state">No detachments published for this faction.</p>{/if}
            </section>
          {:else if page.kind === "unit"}
            <div id="units" class="unit-page">
              <div class="entity-actions"><button class="share-button" onclick={shareCurrentPage}>Share</button></div>
              {#if shareResult === "shared"}<p class="share-status" role="status">Shared</p>{/if}
              {#if shareResult === "copied"}<p class="share-status" role="status">Link copied</p>{/if}
              {#if shareResult === "unavailable"}<label class="manual-url"><span>Copy this link</span><input readonly value={sharedUrl} /></label>{/if}
              <UnitDatacard unit={page.unit} abilityText={abilityText} attachmentBodyguards={dataset.bodyguardsAttachableFrom(page.unit.id, page.faction.id).map((unit) => ({ id: unit.id, name: unit.name }))} />
            </div>
          {:else}
            <header id="detachments" class="page-heading">
              <div><p class="eyebrow">Detachment</p><h1>{page.detachment.raw.name}</h1></div>
              <button class="share-button" onclick={shareCurrentPage}>Share</button>
            </header>
            {#if shareResult === "shared"}<p class="share-status" role="status">Shared</p>{/if}
            {#if shareResult === "copied"}<p class="share-status" role="status">Link copied</p>{/if}
            {#if shareResult === "unavailable"}<label class="manual-url"><span>Copy this link</span><input readonly value={sharedUrl} /></label>{/if}

            <section class="reader-section" aria-labelledby="detachment-rule-title">
              <h2 id="detachment-rule-title">Detachment Rule</h2>
              {#if page.detachment.rules.length}
                {#each page.detachment.rules as rule (rule.id)}
                  {@const ruleText = sourceDescription(rule.id, rule.description)}
                  <div class="rule-card"><h3>{rule.name}</h3>{#if ruleText}<p>{ruleText}</p>{/if}</div>
                {/each}
              {:else}<p class="empty-state">No detachment rule published for this detachment.</p>{/if}
            </section>

            {#if page.detachment.dispositions.length}
              <section class="reader-section" aria-labelledby="dispositions-title">
                <h2 id="dispositions-title">Force Dispositions</h2>
                {#each page.detachment.dispositions as disposition (disposition.id)}
                  <div class="rule-card"><h3>{disposition.name}</h3>{#if disposition.text}<p>{disposition.text}</p>{/if}</div>
                {/each}
              </section>
            {/if}

            <section id="enhancements" class="reader-section" aria-labelledby="enhancements-title">
              <h2 id="enhancements-title">Enhancements</h2>
              {#if page.detachment.enhancements.length}
                {#each page.detachment.enhancements as enhancement (enhancement.id)}
                  {@const ability = resolveAbility(enhancement.ability_id, page.faction.id)}
                  {@const sourceText = sourceDescription(ability?.id ?? "", ability?.description ?? "")}
                  <div class="rule-card"><h3>{enhancement.name} <small>{enhancementMeta(enhancement)}</small></h3>
                    {#if keywordLine("Requires", enhancement.keyword_restrictions)}<p class="restriction">{keywordLine("Requires", enhancement.keyword_restrictions)}</p>{/if}
                    {#if keywordLine("Excludes", enhancement.exclusion_keywords)}<p class="restriction">{keywordLine("Excludes", enhancement.exclusion_keywords)}</p>{/if}
                    {#if sourceText}<p>{sourceText}</p>{/if}
                  </div>
                {/each}
              {:else}<p class="empty-state">No enhancements published for this detachment.</p>{/if}
            </section>

            <section id="stratagems" class="reader-section" aria-labelledby="stratagems-title">
              <h2 id="stratagems-title">Stratagems</h2>
              {#if page.detachment.stratagems.length}
                {#each page.detachment.stratagems as stratagem (stratagem.id)}
                  {@const ability = resolveAbility(stratagem.ability_id, page.faction.id)}
                  {@const restrictions = stratagem.target_restrictions}
                  {@const sourceText = sourceDescription(ability?.id ?? "", ability?.description ?? "")}
                  <div class="rule-card"><h3>{stratagem.name}</h3><p class="meta">{stratagemMeta(stratagem)}</p>
                    {#if restrictions}
                      {#if keywordLine("Targets", restrictions.required_keywords)}<p class="restriction">{keywordLine("Targets", restrictions.required_keywords)}</p>{/if}
                      {#if keywordLine("Targets any", restrictions.required_keywords_any)}<p class="restriction">{keywordLine("Targets any", restrictions.required_keywords_any)}</p>{/if}
                      {#if keywordLine("Excludes", restrictions.excluded_keywords)}<p class="restriction">{keywordLine("Excludes", restrictions.excluded_keywords)}</p>{/if}
                    {/if}
                    {#if sourceText}<p>{sourceText}</p>{/if}
                  </div>
                {/each}
              {:else}<p class="empty-state">No stratagems published for this detachment.</p>{/if}
            </section>

            {#if page.detachment.raw.restrictions || page.detachment.raw.granted_keywords?.length || page.detachment.raw.unit_minimums?.length}
              <section class="reader-section" aria-labelledby="constraints-title">
                <h2 id="constraints-title">Construction Constraints</h2>
                <div class="rule-card">
                  {#if keywordLine("Army requires", page.detachment.raw.restrictions?.required_keywords)}<p>{keywordLine("Army requires", page.detachment.raw.restrictions?.required_keywords)}</p>{/if}
                  {#if keywordLine("Army excludes", page.detachment.raw.restrictions?.excluded_keywords)}<p>{keywordLine("Army excludes", page.detachment.raw.restrictions?.excluded_keywords)}</p>{/if}
                  {#if page.detachment.raw.restrictions?.notes}<p>{page.detachment.raw.restrictions.notes}</p>{/if}
                  {#each page.detachment.raw.granted_keywords ?? [] as grant}<p>Grants <strong>{grant.keyword}</strong> to {grant.to_keywords.join(", ")}{grant.max_selected != null ? ` (up to ${grant.max_selected})` : ""}</p>{/each}
                  {#each page.detachment.raw.unit_minimums ?? [] as minimum}<p>Requires {minimum.min}+ {minimum.keyword} units</p>{/each}
                </div>
              </section>
            {/if}
          {/if}
        </article>
      </div>
    {/if}
  </main>

  <AppFooter notice="Ability text is fetched at runtime from 40kdc-abilities." version={__DATA_VERSION__} build={__BUILD_SHA__} />
</div>
