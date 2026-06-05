<script lang="ts">
  import type { Snippet } from "svelte";

  // Collapsible pane on native <details>/<summary>: free keyboard handling and
  // semantics. `defaultOpen` is reactive (hosts auto-open panes once they have
  // content); a user's explicit toggle becomes a sticky localStorage override
  // until they return the pane to its auto state.
  //
  // Styling is self-contained (shadowboxing fallbacks) but follows the host's
  // tokens when present, so the component works in any example app.
  let {
    id,
    title,
    storagePrefix = "40kdc",
    defaultOpen = false,
    children,
  }: {
    id: string;
    title: string;
    /** Namespace for the persisted open/closed override (e.g. "salvo"). */
    storagePrefix?: string;
    defaultOpen?: boolean;
    children?: Snippet;
  } = $props();

  const storageKey = $derived(`${storagePrefix}.pane.${id}.open`);

  // null = follow defaultOpen reactively; true/false = user override.
  let userOverride = $state<boolean | null>(null);
  $effect(() => {
    const stored = localStorage.getItem(storageKey);
    userOverride = stored === null ? null : stored === "1";
  });

  const open = $derived(userOverride ?? defaultOpen);

  function onToggle(event: Event) {
    const next = (event.currentTarget as HTMLDetailsElement).open;
    if (next === open) return;
    if (next === defaultOpen) {
      // Returning to auto state — drop the override so future content
      // changes can move the pane again.
      userOverride = null;
      localStorage.removeItem(storageKey);
    } else {
      userOverride = next;
      localStorage.setItem(storageKey, next ? "1" : "0");
    }
  }
</script>

<details class="pane" {open} ontoggle={onToggle}>
  <summary>
    <span class="chev" aria-hidden="true"></span>
    <h2>{title}</h2>
  </summary>
  <div class="pane-body">{@render children?.()}</div>
</details>

<style>
  .pane {
    background: var(--panel, oklch(0.224 0.008 286));
    border: 1px solid var(--border, oklch(0.304 0.011 286));
    border-radius: var(--radius-md, 4px);
    box-shadow: var(
      --shadow-sm,
      0 1px 0 0 rgba(255, 255, 255, 0.04) inset,
      0 1px 0 0 rgba(0, 0, 0, 0.6),
      0 4px 8px -2px rgba(0, 0, 0, 0.8)
    );
  }

  summary {
    list-style: none;
    cursor: pointer;
    padding: var(--space-3, 12px);
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    user-select: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus, 0 0 0 2px oklch(0.704 0.123 183));
    border-radius: var(--radius-md, 4px);
  }

  summary h2 {
    margin: 0;
    font-family: var(--font-heading, "Barlow Condensed", system-ui, sans-serif);
    font-size: var(--text-2xs, 11px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider, 0.08em);
    color: var(--muted, oklch(0.735 0.014 286));
  }
  details[open] summary h2 {
    color: var(--text, oklch(0.947 0.004 286));
  }

  .chev {
    width: 8px;
    height: 8px;
    border-right: 1.5px solid var(--muted, oklch(0.735 0.014 286));
    border-bottom: 1.5px solid var(--muted, oklch(0.735 0.014 286));
    transform: rotate(-45deg);
    transition: transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
    margin-left: 2px;
    flex: 0 0 auto;
  }
  details[open] .chev {
    transform: rotate(45deg);
    border-color: var(--text, oklch(0.947 0.004 286));
  }

  .pane-body {
    padding: 0 var(--space-3, 12px) var(--space-3, 12px);
  }
</style>
