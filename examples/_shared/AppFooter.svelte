<script lang="ts">
  import GithubMark from "./GithubMark.svelte";
  import {
    PACKAGE_NAME,
    PACKAGE_URL,
    PATREON_URL,
    PUBLISHER_URL,
    REPO_URL,
  } from "./links.js";

  // The standard example-app footer: one baseline-aligned row of text links
  // separated by muted middots, in a fixed order — repo (the only item with a
  // glyph), powered-by package, cross-app links, publisher, Patreon. Every app
  // renders the same promotion the same way.
  let {
    repoUrl = REPO_URL,
    packageUrl = PACKAGE_URL,
    publisherUrl = PUBLISHER_URL,
    patreonUrl = PATREON_URL,
    links = [],
  }: {
    repoUrl?: string;
    packageUrl?: string;
    publisherUrl?: string;
    patreonUrl?: string;
    /** Cross-app links (e.g. the other example apps), after the package segment. */
    links?: { label: string; href: string }[];
  } = $props();
</script>

<footer class="app-footer">
  <a class="repo" href={repoUrl} target="_blank" rel="noreferrer noopener">
    <GithubMark size={14} />
    github.com/wn-mitch/40kdc-data
  </a>
  <span class="dot" aria-hidden="true">·</span>
  <span class="powered">
    powered by
    <a href={packageUrl} target="_blank" rel="noreferrer noopener"><code>{PACKAGE_NAME}</code></a>
  </span>
  {#each links as link (link.href)}
    <span class="dot" aria-hidden="true">·</span>
    <a href={link.href} target="_blank" rel="noreferrer noopener">{link.label}</a>
  {/each}
  <span class="dot" aria-hidden="true">·</span>
  <a href={publisherUrl} target="_blank" rel="noreferrer noopener">alpacasoft.dev</a>
  <span class="dot" aria-hidden="true">·</span>
  <a href={patreonUrl} target="_blank" rel="noreferrer noopener">Support on Patreon</a>
</footer>

<style>
  .app-footer {
    display: flex;
    align-items: baseline;
    gap: var(--space-2, 8px);
    min-height: 32px;
    padding: var(--space-2, 8px) var(--space-4, 16px);
    background: var(--panel, oklch(0.224 0.008 286));
    border-top: 1px solid var(--border, oklch(0.304 0.011 286));
    font-size: var(--text-2xs, 11px);
    color: var(--dim, oklch(0.637 0.015 286));
  }
  .app-footer a {
    color: var(--muted, oklch(0.735 0.014 286));
    text-decoration: none;
    transition: color 80ms ease;
  }
  .app-footer a:hover,
  .app-footer a:focus-visible {
    color: var(--accent, oklch(0.704 0.123 183));
  }
  .repo {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
  }
  .repo :global(svg) {
    /* The mark rides the text baseline rather than stretching the row. */
    align-self: center;
  }
  code {
    font-family: var(--font-mono, "JetBrains Mono", ui-monospace, monospace);
    font-size: var(--text-2xs, 11px);
  }
  .dot {
    color: var(--border-strong, oklch(0.513 0.014 286));
  }
  @media (max-width: 640px) {
    .app-footer {
      flex-wrap: wrap;
      padding: var(--space-2, 8px) var(--space-3, 12px);
    }
  }
</style>
