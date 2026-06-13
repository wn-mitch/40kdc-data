<script lang="ts">
  /**
   * Opponent-facing share sheet for a live session: a big QR of the live link
   * to hold up across the table, plus the copyable URL. Reads the links the
   * doc-session minted on "Go live" (the host holds both role links; a joiner
   * holds only their own). Edit links let the opponent score their side; view
   * links are read-only.
   */
  import Modal from "../../../_shared/Modal.svelte";
  import { docSession } from "../../../_shared/doc-session.svelte";
  import QrCode from "./QrCode.svelte";

  let { open = $bindable(false), onFlash }: { open?: boolean; onFlash: (msg: string) => void } =
    $props();

  let mode = $state<"editor" | "viewer">("editor");

  const link = $derived(
    (mode === "editor" ? docSession.editorLink : docSession.viewerLink) ??
      docSession.editorLink ??
      docSession.viewerLink,
  );

  async function copy(): Promise<void> {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      onFlash("Link copied.");
    } catch {
      onFlash("Clipboard blocked — long-press the link to copy it.");
    }
  }
</script>

<Modal bind:open title="Share with your opponent">
  <div class="flex flex-col items-center gap-3">
    {#if link}
      <div class="flex gap-1" role="group" aria-label="Link type">
        {#each [{ k: "editor", label: "Can score" }, { k: "viewer", label: "View only" }] as opt (opt.k)}
          <button
            type="button"
            class="focus-ring min-h-9 rounded border px-3 py-1 font-heading text-[11px] font-bold uppercase tracking-wide transition-colors {mode ===
            opt.k
              ? 'border-accent bg-accent text-accent-foreground'
              : 'border-border-strong bg-panel text-text-muted hover:border-accent hover:text-accent'}"
            aria-pressed={mode === opt.k}
            onclick={() => (mode = opt.k as "editor" | "viewer")}>{opt.label}</button
          >
        {/each}
      </div>

      <div class="rounded-lg bg-white p-2">
        <QrCode value={link} />
      </div>

      <p class="text-center text-xs text-text-muted">
        Your opponent scans this to join — {mode === "editor"
          ? "they can score their own side."
          : "read-only."}
      </p>

      <div class="flex w-full gap-2">
        <input
          type="text"
          readonly
          value={link}
          class="min-w-0 flex-1 rounded border border-border-strong bg-panel px-2 py-2 font-mono text-[11px] text-text"
          onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
          aria-label="Share link"
        />
        <button
          type="button"
          class="focus-ring min-h-11 shrink-0 rounded border border-border-strong bg-panel px-3 font-heading text-xs font-bold uppercase tracking-wide text-text-muted hover:border-accent hover:text-accent"
          onclick={copy}>Copy</button
        >
      </div>
    {:else}
      <p class="text-sm text-text-muted">Go live first to get a link to share.</p>
    {/if}
  </div>
</Modal>
