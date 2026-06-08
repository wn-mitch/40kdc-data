<script lang="ts">
  import type { Snippet } from "svelte";
  import GithubMark from "./GithubMark.svelte";
  import { HOME_URL, PACKAGE_NAME, PACKAGE_URL, REPO_URL } from "./links.js";

  // The standard example-app header: brand left (uppercase accent title plus a
  // muted tag), an optional app-controls snippet, then the uniform compact link
  // cluster. Narrow-screen rules are shared so every app trims identically:
  // the tag and package link drop below 640px, everything but the back-link
  // drops below 380px.
  //
  // Styling is self-contained (shadowboxing fallbacks) but follows the host's
  // tokens when present, so the component works in Tailwind and scoped-CSS hosts.
  let {
    title,
    tag,
    brandHref = REPO_URL,
    homeUrl = HOME_URL,
    repoUrl = REPO_URL,
    packageUrl = PACKAGE_URL,
    onBrand,
    nav,
  }: {
    title: string;
    /** Short descriptor next to the title; hidden below 640px. */
    tag?: string;
    brandHref?: string;
    homeUrl?: string;
    repoUrl?: string;
    packageUrl?: string;
    /**
     * In-app brand action. When set, clicking the brand calls this instead of
     * navigating to `brandHref` — e.g. returning a single-page app to its home
     * screen rather than opening the repo.
     */
    onBrand?: () => void;
    /** App-specific controls rendered between the brand and the link cluster. */
    nav?: Snippet;
  } = $props();
</script>

<header class="app-header">
  {#if onBrand}
    <button type="button" class="brand" onclick={onBrand}>
      <h1>{title}</h1>
      {#if tag}<span class="tag">{tag}</span>{/if}
    </button>
  {:else}
    <a class="brand" href={brandHref} target="_blank" rel="noreferrer noopener">
      <h1>{title}</h1>
      {#if tag}<span class="tag">{tag}</span>{/if}
    </a>
  {/if}
  {#if nav}
    <nav class="app-nav" aria-label="App controls">{@render nav()}</nav>
  {/if}
  <nav class="links" aria-label="Project links">
    <a class="home" href={homeUrl} aria-label="Back to 40kdc-data examples">← 40kdc-data</a>
    <a href={repoUrl} target="_blank" rel="noreferrer noopener" aria-label="GitHub repository">
      <GithubMark />
    </a>
    <a class="pkg" href={packageUrl} target="_blank" rel="noreferrer noopener">
      <code>{PACKAGE_NAME}</code>
    </a>
  </nav>
</header>

<style>
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4, 16px);
    min-height: 44px;
    padding: var(--space-1, 4px) var(--space-4, 16px);
    background: var(--panel, oklch(0.224 0.008 286));
    border-bottom: 1px solid var(--border, oklch(0.304 0.011 286));
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: var(--space-3, 12px);
    text-decoration: none;
    color: inherit;
    min-width: 0;
    flex: 0 1 auto;
    /* reset for when `.brand` is a <button> (onBrand mode) */
    appearance: none;
    background: none;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  h1 {
    margin: 0;
    font-family: var(--font-heading, "Barlow Condensed", system-ui, sans-serif);
    font-size: var(--text-lg, 18px);
    font-weight: 800;
    letter-spacing: var(--tracking-wider, 0.08em);
    text-transform: uppercase;
    line-height: 1;
    color: var(--accent, oklch(0.704 0.123 183));
  }
  .brand:hover h1 {
    color: var(--accent-hover, oklch(0.6 0.104 185));
  }
  .tag {
    color: var(--muted, oklch(0.735 0.014 286));
    font-size: var(--text-xs, 12px);
    font-family: var(--font-heading, "Barlow Condensed", system-ui, sans-serif);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide, 0.05em);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .app-nav {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    flex-wrap: wrap;
    min-width: 0;
    flex: 1 1 auto;
    justify-content: flex-end;
  }
  .links {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    flex: 0 0 auto;
  }
  .links a {
    display: inline-flex;
    align-items: center;
    color: var(--muted, oklch(0.735 0.014 286));
    text-decoration: none;
    transition: color 80ms ease;
  }
  .links a:hover,
  .links a:focus-visible {
    color: var(--accent, oklch(0.704 0.123 183));
  }
  .links .home {
    font-family: var(--font-heading, "Barlow Condensed", system-ui, sans-serif);
    font-size: var(--text-2xs, 11px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide, 0.05em);
    white-space: nowrap;
  }
  .links .pkg code {
    font-family: var(--font-mono, "JetBrains Mono", ui-monospace, monospace);
    font-size: var(--text-2xs, 11px);
  }
  @media (max-width: 640px) {
    .app-header {
      padding-left: var(--space-3, 12px);
      padding-right: var(--space-3, 12px);
      gap: var(--space-2, 8px);
    }
    .tag {
      display: none;
    }
    .links .pkg {
      display: none;
    }
  }
  @media (max-width: 380px) {
    /* Keep the back-link on the smallest phones; drop the rest. */
    .links a:not(.home) {
      display: none;
    }
  }
</style>
