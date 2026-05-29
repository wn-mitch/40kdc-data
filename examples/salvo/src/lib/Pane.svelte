<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    id,
    title,
    defaultOpen = false,
    children,
  }: {
    id: string;
    title: string;
    defaultOpen?: boolean;
    children?: Snippet;
  } = $props();

  const storageKey = $derived(`salvo.pane.${id}.open`);

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
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  summary {
    list-style: none;
    cursor: pointer;
    padding: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    user-select: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: none; box-shadow: var(--shadow-focus); border-radius: var(--radius-md); }

  summary h2 {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--muted);
  }
  details[open] summary h2 { color: var(--text); }

  .chev {
    width: 8px;
    height: 8px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: rotate(-45deg);
    transition: transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
    margin-left: 2px;
    flex: 0 0 auto;
  }
  details[open] .chev {
    transform: rotate(45deg);
    border-color: var(--text);
  }

  .pane-body {
    padding: 0 var(--space-3) var(--space-3);
  }
</style>
