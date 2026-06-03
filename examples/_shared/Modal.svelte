<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Generic modal shell shared by the 40kdc example apps. Built on the native
   * `<dialog>` element so focus trapping, Escape-to-close, and inertness of the
   * background come for free. Styling is fully scoped and the shadowboxing
   * palette is hardcoded (not read from host CSS variables) so the modal looks
   * identical whether the host app styles with Tailwind v4 (mission-matrix) or
   * plain CSS custom properties (salvo, layout-editor).
   */
  interface Props {
    /** Controls visibility. Bindable so the host (and Escape/backdrop) stay in sync. */
    open?: boolean;
    /** Heading shown in the modal chrome. */
    title: string;
    /** Modal body. */
    children: Snippet;
    /** Fired after the dialog closes (Escape, backdrop, or close button). */
    onClose?: () => void;
  }

  let { open = $bindable(false), title, children, onClose }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);

  // Drive the native open/closed state from the `open` prop. showModal() throws
  // if already open and close() is a no-op when closed, so guard both.
  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  function handleClose(): void {
    open = false;
    onClose?.();
  }

  // Clicking the ::backdrop registers as a click on the dialog element itself
  // (the inner .panel stops propagation implicitly by being a child target).
  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialogEl) handleClose();
  }
</script>

<dialog bind:this={dialogEl} onclose={handleClose} onclick={handleBackdropClick}>
  <div class="panel" role="document">
    <header>
      <h2>{title}</h2>
      <button type="button" class="close" aria-label="Close" onclick={handleClose}>×</button>
    </header>
    <div class="body">
      {@render children()}
    </div>
  </div>
</dialog>

<style>
  dialog {
    padding: 0;
    border: none;
    background: transparent;
    color: #ededf0;
    max-width: min(92vw, 30rem);
    width: 100%;
    /* Restore the UA's centering. Tailwind v4 Preflight resets `margin: 0` on the
       universal selector, which overrides `dialog`'s default `margin: auto` and
       pins the modal to the top-left; re-asserting it here re-centers under
       Tailwind and is a no-op for the plain-CSS example apps. */
    margin: auto;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(2px);
  }
  .panel {
    background: #1b1b1f;
    border: 1px solid #2e2e34;
    border-radius: 8px;
    box-shadow:
      0 1px 0 0 rgba(255, 255, 255, 0.08) inset,
      0 2px 0 0 rgba(0, 0, 0, 0.8),
      0 20px 40px -8px rgba(0, 0, 0, 0.95);
    overflow: hidden;
    font-family: "Barlow", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid #262629;
    background: #151517;
  }
  h2 {
    margin: 0;
    font-family: "Barlow Condensed", system-ui, sans-serif;
    font-size: 1.15rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #14b8a6;
  }
  .close {
    flex: 0 0 auto;
    font: inherit;
    font-size: 1.35rem;
    line-height: 1;
    width: 1.9rem;
    height: 1.9rem;
    display: grid;
    place-items: center;
    background: #0c0c0e;
    color: #a8a8b2;
    border: 1px solid #2e2e34;
    border-radius: 4px;
    cursor: pointer;
  }
  .close:hover {
    color: #ededf0;
    border-color: #14b8a6;
  }
  .close:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px #14b8a6;
  }
  .body {
    padding: 1.1rem 1rem 1.2rem;
    font-size: 0.95rem;
    line-height: 1.5;
    color: #ededf0;
  }
</style>
