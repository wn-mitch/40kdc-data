<script lang="ts">
  import { disconnect, entitlement, storedEntitlement } from "./entitlement.svelte";
  import {
    createDoc,
    deleteDoc,
    getDoc,
    listDocs,
    mintLink,
    putDoc,
    shortlinkUrl,
    type DocKind,
    type DocMeta,
  } from "./sync-api";

  /**
   * Generic cloud-documents pane (patron feature): list/open/delete the
   * owner's docs of one kind, upload local items, and share them — live doc
   * links via the host's ShareLinksModal (`onShare`), or the legacy
   * mint-a-snapshot-shortlink fallback when the host hasn't wired one yet.
   * Kind-agnostic — the host supplies the local items and decides what
   * "open" means. Cross-device conflicts surface via the worker's 409
   * (ifUpdatedAt) as an explicit prompt, never a silent clobber.
   */
  interface LocalItem {
    name: string;
    payload: unknown;
  }
  interface Props {
    kind: DocKind;
    /** Local items uploadable to the cloud (current plan, saved lists, …). */
    localItems: LocalItem[];
    /** Open a cloud doc into the app. The doc meta is passed last so a host can
     *  bind subsequent saves to that doc (id) and detect cross-device conflicts
     *  (updatedAt); 2-arg callers stay valid. */
    onOpen: (name: string, payload: unknown, doc?: { id: string; updatedAt: number }) => void;
    /** Open the host's share dialog (live + snapshot links) for a doc. */
    onShare?: (doc: DocMeta) => void;
    /** Surface a transient message (host owns the toast). */
    onFlash: (msg: string) => void;
    /** Ask the host to show the entitlement gate. */
    onNeedEntitlement: () => void;
  }
  let { kind, localItems, onOpen, onShare, onFlash, onNeedEntitlement }: Props = $props();

  let docs = $state<DocMeta[]>([]);
  let loaded = $state(false);
  let busy = $state(false);
  let uploadIdx = $state(0);

  export async function refresh(): Promise<void> {
    const token = storedEntitlement();
    if (!token) {
      docs = [];
      loaded = false;
      return;
    }
    const res = await listDocs(token, kind);
    if (res.ok) {
      docs = res.value;
      loaded = true;
    } else {
      onFlash(`Couldn't load cloud saves (${res.error}).`);
    }
  }

  // Load the listing whenever the pane becomes entitled.
  $effect(() => {
    if (entitlement.connected && !loaded) void refresh();
  });

  function requireToken(): string | null {
    const token = storedEntitlement();
    if (!token) onNeedEntitlement();
    return token;
  }

  async function upload(): Promise<void> {
    const token = requireToken();
    const item = localItems[uploadIdx];
    if (!token || !item) return;
    busy = true;
    try {
      // Same-name cloud doc → update (with the conflict hint); else create.
      const existing = docs.find((d) => d.name === item.name);
      if (existing) {
        const res = await putDoc(token, existing.id, {
          payload: item.payload,
          ifUpdatedAt: existing.updated_at,
        });
        if (!res.ok && "conflict" in res) {
          const overwrite = confirm(
            `"${existing.name}" changed in the cloud since this device last saw it ` +
              `(${new Date(res.conflict.updated_at).toLocaleString()}). Overwrite it?`,
          );
          if (overwrite) {
            const forced = await putDoc(token, existing.id, { payload: item.payload });
            onFlash(forced.ok ? `Overwrote “${item.name}” in the cloud.` : uploadError(forced));
          }
        } else {
          onFlash(res.ok ? `Updated “${item.name}” in the cloud.` : uploadError(res));
        }
      } else {
        const res = await createDoc(token, { kind, name: item.name, payload: item.payload });
        onFlash(
          res.ok
            ? `Saved “${item.name}” to the cloud.`
            : res.error === "doc_quota_exceeded"
              ? "Cloud is full — delete some saves first."
              : "Cloud save failed.",
        );
      }
      await refresh();
    } finally {
      busy = false;
    }
  }

  /** Honest copy for a refused snapshot upload — doc_live gets steering. */
  function uploadError(res: { ok: boolean; error?: string }): string {
    return !res.ok && res.error === "doc_live"
      ? "This save is being edited live right now — join the live session to change it."
      : "Cloud save failed.";
  }

  async function open(doc: DocMeta): Promise<void> {
    const token = requireToken();
    if (!token) return;
    const res = await getDoc(token, doc.id);
    if (res.ok) onOpen(res.value.name, res.value.payload, { id: res.value.id, updatedAt: res.value.updated_at });
    else onFlash(`Couldn't open “${doc.name}” (${res.error}).`);
  }

  async function remove(doc: DocMeta): Promise<void> {
    const token = requireToken();
    if (!token || !confirm(`Delete “${doc.name}” from the cloud?`)) return;
    const res = await deleteDoc(token, doc.id);
    if (res.ok) await refresh();
    else onFlash(`Couldn't delete “${doc.name}” (${res.error}).`);
  }

  async function share(doc: DocMeta): Promise<void> {
    const token = requireToken();
    if (!token) return;
    // The host's dialog (live links + copyable URLs) is the real share UX.
    if (onShare) {
      onShare(doc);
      return;
    }
    // Legacy fallback: mint a fresh snapshot shortlink straight to clipboard.
    const full = await getDoc(token, doc.id);
    if (!full.ok) {
      onFlash(`Couldn't read “${doc.name}” (${full.error}).`);
      return;
    }
    const res = await mintLink(token, kind, full.value.payload);
    if (!res.ok) {
      onFlash(
        res.error === "link_quota_exceeded"
          ? "Short-link quota reached."
          : `Couldn't mint a short link (${res.error}).`,
      );
      return;
    }
    const url = shortlinkUrl(location.origin, location.pathname, res.value);
    try {
      await navigator.clipboard.writeText(url);
      onFlash(`Short link copied: ${url}`);
    } catch {
      onFlash(`Short link: ${url}`);
    }
  }
</script>

<section class="cloud">
  <header>
    <h3>Cloud</h3>
    {#if entitlement.connected && entitlement.shared}
      <span class="shared" title="This identity comes from an access key — everyone holding it shares these saves.">
        shared key
      </span>
    {/if}
  </header>

  {#if !entitlement.connected}
    <p class="hint">
      Sync across devices and mint short links —
      <button type="button" class="linkish" onclick={onNeedEntitlement}>connect Patreon</button>.
    </p>
  {:else}
    {#if localItems.length > 0}
      <div class="row">
        {#if localItems.length > 1}
          <select bind:value={uploadIdx} aria-label="local item to upload">
            {#each localItems as item, i (i)}
              <option value={i}>{item.name}</option>
            {/each}
          </select>
        {:else}
          <span class="single">{localItems[0].name}</span>
        {/if}
        <button type="button" disabled={busy} onclick={upload}>↑ Save to cloud</button>
      </div>
    {/if}

    {#if docs.length === 0}
      <p class="hint">{loaded ? "No cloud saves yet." : "Loading…"}</p>
    {:else}
      <ul>
        {#each docs as doc (doc.id)}
          <li>
            <button type="button" class="name" onclick={() => open(doc)} title="Open">
              {doc.name}
            </button>
            {#if doc.shared}
              <span class="badge" title="This save has live share links.">shared</span>
            {/if}
            <span class="when">{new Date(doc.updated_at).toLocaleDateString()}</span>
            <button type="button" class="action" onclick={() => share(doc)}>
              {onShare ? "Share" : "Link"}
            </button>
            <button type="button" class="action danger" onclick={() => remove(doc)} aria-label="delete">
              ×
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <footer>
      <span class="identity" title={entitlement.sub ?? undefined}>
        {entitlement.shared && entitlement.sub
          ? `key: ${entitlement.sub.slice("key:".length)}`
          : "Patreon"}
      </span>
      <button type="button" class="linkish" onclick={disconnect}>Sign out</button>
    </footer>
  {/if}
</section>

<style>
  /* Self-contained palette, same convention as Modal/SupportModal. */
  .cloud {
    border: 1px solid #2e2e34;
    border-radius: 8px;
    background: #151517;
    padding: 0.7rem 0.8rem;
    font-family: "Barlow", system-ui, sans-serif;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  h3 {
    margin: 0;
    font-family: "Barlow Condensed", system-ui, sans-serif;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #14b8a6;
  }
  .shared {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #a8a8b2;
    border: 1px solid #2e2e34;
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
  }
  .hint {
    margin: 0.45rem 0 0;
    color: #a8a8b2;
    font-size: 0.8rem;
  }
  .linkish {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: #14b8a6;
    cursor: pointer;
    text-decoration: underline;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    align-items: center;
  }
  select,
  .single {
    flex: 1;
    min-width: 0;
    background: #0c0c0e;
    color: #ededf0;
    border: 1px solid #2e2e34;
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font: inherit;
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row button {
    background: #1b1b1f;
    color: #ededf0;
    border: 1px solid #66666f;
    border-radius: 6px;
    padding: 0.35rem 0.7rem;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .row button:disabled {
    opacity: 0.4;
  }
  ul {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid #232327;
    border-radius: 6px;
    padding: 0.3rem 0.5rem;
    background: #1b1b1f;
  }
  .name {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 0.85rem;
    color: #ededf0;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name:hover {
    color: #2dd4bf;
  }
  .when {
    color: #66666f;
    font-size: 0.7rem;
  }
  .badge {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #2dd4bf;
    border: 1px solid #1f3d3a;
    border-radius: 999px;
    padding: 0 0.4rem;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 0.6rem;
    padding-top: 0.5rem;
    border-top: 1px solid #232327;
  }
  .identity {
    color: #66666f;
    font-size: 0.7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  footer .linkish {
    font-size: 0.75rem;
    color: #a8a8b2;
  }
  footer .linkish:hover {
    color: #f87171;
  }
  .action {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 0.75rem;
    color: #a8a8b2;
    cursor: pointer;
  }
  .action:hover {
    color: #ededf0;
  }
  .danger:hover {
    color: #f87171;
  }
</style>
