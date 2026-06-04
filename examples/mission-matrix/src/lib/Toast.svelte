<script lang="ts">
  import { fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";

  // Controlled toast: the app sets `message`, we self-dismiss after a beat.
  // One slot is enough — a newer message restarts the timer and replaces the
  // text in place.
  let {
    message,
    onDismiss,
  }: {
    message: string | null;
    onDismiss: () => void;
  } = $props();

  const VISIBLE_MS = 2500;

  $effect(() => {
    if (message === null) return;
    const t = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(t);
  });
</script>

<!-- The aria-live region stays mounted so screen readers announce changes;
     only the visual pill enters and exits. -->
<div
  class="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
  role="status"
  aria-live="polite"
>
  {#if message !== null}
    <div
      class="rounded border border-border-strong bg-surface px-3 py-2 font-heading text-xs font-bold uppercase tracking-wide text-text shadow-md"
      transition:fly={{ y: 8, duration: 180, easing: quintOut }}
    >
      {message}
    </div>
  {/if}
</div>
