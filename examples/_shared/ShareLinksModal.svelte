<script lang="ts">
  import Modal from "./Modal.svelte";
  import { storedEntitlement } from "./entitlement.svelte";
  import {
    docInviteUrl,
    getDoc,
    mintLink,
    shareDoc,
    shortlinkUrl,
    type DocMeta,
  } from "./sync-api";

  /**
   * Per-doc sharing dialog (the Google-docs moment): durable live links —
   * edit and view — shown as visible, copyable URLs, plus a "send a copy"
   * snapshot shortlink for handing someone a frozen version. Live tokens are
   * minted lazily on first open and are STABLE: reopening the dialog shows
   * the same links, and "Regenerate" is the explicit revocation gesture.
   */
  interface Props {
    open?: boolean;
    /** The doc being shared (null while no row is selected). */
    doc: DocMeta | null;
    /** Convert a cloud payload to the storage/interop shape before minting a
     *  snapshot (live-edited docs are stored session-shaped). */
    exportPayload?: (payload: unknown) => unknown;
    /** Join the live session as editor (the host owns the session UI). */
    onOpenLive: (docId: string, editorToken: string) => void;
    onFlash: (msg: string) => void;
  }
  let {
    open = $bindable(false),
    doc,
    exportPayload = (p) => p,
    onOpenLive,
    onFlash,
  }: Props = $props();

  let tokens = $state<{ editorToken: string; viewerToken: string } | null>(null);
  let snapshotUrl = $state<string | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let loadedFor: string | null = null;

  // Lazy-mint the durable tokens when the dialog opens on a (new) doc.
  $effect(() => {
    if (!open || !doc) return;
    if (doc.id === loadedFor) return;
    loadedFor = doc.id;
    tokens = null;
    snapshotUrl = null;
    error = null;
    void loadTokens(doc.id, false);
  });

  async function loadTokens(docId: string, regenerate: boolean): Promise<void> {
    const token = storedEntitlement();
    if (!token) {
      error = "Sign in to share this save.";
      return;
    }
    busy = true;
    try {
      const res = await shareDoc(token, docId, regenerate);
      if (res.ok) {
        tokens = res.value;
        error = null;
      } else {
        error = `Couldn't mint share links (${res.error}).`;
      }
    } finally {
      busy = false;
    }
  }

  const editUrl = $derived(
    doc && tokens ? docInviteUrl(location.origin, location.pathname, doc.id, tokens.editorToken) : null,
  );
  const viewUrl = $derived(
    doc && tokens ? docInviteUrl(location.origin, location.pathname, doc.id, tokens.viewerToken) : null,
  );

  async function copy(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      onFlash(`${label} copied.`);
    } catch {
      onFlash("Clipboard blocked — select the link text and copy it manually.");
    }
  }

  async function mintSnapshot(): Promise<void> {
    const token = storedEntitlement();
    if (!doc || !token) return;
    busy = true;
    try {
      const full = await getDoc(token, doc.id);
      if (!full.ok) {
        onFlash(`Couldn't read “${doc.name}” (${full.error}).`);
        return;
      }
      const res = await mintLink(token, doc.kind, exportPayload(full.value.payload));
      if (!res.ok) {
        onFlash(
          res.error === "link_quota_exceeded"
            ? "Short-link quota reached."
            : `Couldn't mint a copy link (${res.error}).`,
        );
        return;
      }
      snapshotUrl = shortlinkUrl(location.origin, location.pathname, res.value);
    } finally {
      busy = false;
    }
  }

  function regenerate(): void {
    if (!doc) return;
    if (
      !confirm(
        "Regenerate the live links? Links you've already sent will stop admitting new joins.",
      )
    ) {
      return;
    }
    void loadTokens(doc.id, true);
  }

  function openLive(): void {
    if (!doc || !tokens) return;
    open = false;
    onOpenLive(doc.id, tokens.editorToken);
  }

  function selectAll(e: Event): void {
    (e.currentTarget as HTMLInputElement).select();
  }
</script>

<Modal bind:open title={doc ? `Share “${doc.name}”` : "Share"}>
  <div class="share">
    {#if error}
      <p class="error">{error}</p>
    {:else if !tokens}
      <p class="hint">Minting links…</p>
    {:else}
      <p class="hint">
        Live links open <em>this</em> document — everyone sees and shares edits in real time,
        and changes are saved to the cloud.
      </p>

      {#if editUrl}
        <div class="linkrow">
          <span class="label">Edit link <span class="sub">(live)</span></span>
          <div class="row">
            <input type="text" readonly value={editUrl} onclick={selectAll} aria-label="edit link" />
            <button type="button" onclick={() => copy(editUrl, "Edit link")}>Copy</button>
          </div>
        </div>
      {/if}
      {#if viewUrl}
        <div class="linkrow">
          <span class="label">View link <span class="sub">(live, read-only)</span></span>
          <div class="row">
            <input type="text" readonly value={viewUrl} onclick={selectAll} aria-label="view link" />
            <button type="button" onclick={() => copy(viewUrl, "View link")}>Copy</button>
          </div>
        </div>
      {/if}

      <div class="linkrow">
        <span class="label">Send a copy <span class="sub">(frozen — not the live document)</span></span>
        {#if snapshotUrl}
          <div class="row">
            <input type="text" readonly value={snapshotUrl} onclick={selectAll} aria-label="copy link" />
            <button type="button" onclick={() => copy(snapshotUrl ?? "", "Copy link")}>Copy</button>
          </div>
        {:else}
          <div class="row">
            <button type="button" disabled={busy} onclick={mintSnapshot}>Create copy link</button>
          </div>
        {/if}
      </div>

      <div class="actions">
        <button type="button" class="primary" disabled={busy} onclick={openLive}>
          ⦿ Open live
        </button>
        <button type="button" class="quiet" disabled={busy} onclick={regenerate}>
          Regenerate links
        </button>
      </div>
    {/if}
  </div>
</Modal>

<style>
  /* Self-contained palette, same convention as Modal/CloudSavesPane. */
  .share {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    font-family: "Barlow", system-ui, sans-serif;
  }
  .hint {
    margin: 0;
    color: #a8a8b2;
    font-size: 0.85rem;
  }
  .hint em {
    color: #ededf0;
    font-style: normal;
    font-weight: 600;
  }
  .error {
    margin: 0;
    color: #f87171;
    font-size: 0.85rem;
  }
  .linkrow {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #a8a8b2;
    font-weight: 700;
  }
  .label .sub {
    color: #66666f;
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  input {
    flex: 1;
    min-width: 0;
    background: #0c0c0e;
    color: #ededf0;
    border: 1px solid #2e2e34;
    border-radius: 6px;
    padding: 0.4rem 0.55rem;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 0.72rem;
  }
  input:focus-visible {
    outline: none;
    border-color: #14b8a6;
  }
  button {
    background: #1b1b1f;
    color: #ededf0;
    border: 1px solid #66666f;
    border-radius: 6px;
    padding: 0.4rem 0.8rem;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover {
    border-color: #14b8a6;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    border-top: 1px solid #232327;
    padding-top: 0.8rem;
  }
  .primary {
    background: #14b8a6;
    color: #04221e;
    border: none;
    font-weight: 600;
  }
  .primary:hover {
    background: #2dd4bf;
  }
  .quiet {
    background: none;
    border: none;
    color: #a8a8b2;
    text-decoration: underline;
    padding: 0.4rem 0.2rem;
  }
  .quiet:hover {
    color: #f87171;
    border: none;
  }
</style>
