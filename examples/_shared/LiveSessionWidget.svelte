<script lang="ts">
  import {
    confirmNickname,
    docSession,
    leaveDocSession,
    retryLive,
    sendNickname,
  } from "./doc-session.svelte";
  import { normalizeNickname, storedNickname } from "./nickname";

  /**
   * Floating live-session widget (bottom-left, all apps): the nickname
   * prompt before a first join, then the connection status, doc name,
   * participant roster with real nicknames, inline rename, invite-link copy,
   * and the read-only snapshot fallback with Retry. Hidden while idle — the
   * host's "Go live" / invite-link handling drives the session state.
   */
  interface Props {
    onFlash: (msg: string) => void;
  }
  let { onFlash }: Props = $props();

  let nameInput = $state(storedNickname() ?? "");
  let renaming = $state(false);
  let renameInput = $state("");

  const self = $derived(
    docSession.participants.find((p) => p.id === docSession.participantId) ?? null,
  );

  function join(): void {
    const name = normalizeNickname(nameInput);
    if (!name) return;
    confirmNickname(name);
  }

  function startRename(): void {
    renameInput = self?.nickname ?? "";
    renaming = true;
  }

  function applyRename(): void {
    const name = normalizeNickname(renameInput);
    if (name) sendNickname(name);
    renaming = false;
  }

  async function copyLink(link: string | null, label: string): Promise<void> {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      onFlash(`${label} link copied.`);
    } catch {
      onFlash(`${label} link: ${link}`);
    }
  }
</script>

{#if docSession.status !== "idle"}
  <aside class="widget" aria-label="Live session">
    {#if docSession.status === "prompt-nickname"}
      <header>
        <span class="title">Joining live session</span>
      </header>
      <p class="hint">Pick a name others will see:</p>
      <div class="row">
        <input
          type="text"
          placeholder="your name"
          maxlength="40"
          bind:value={nameInput}
          onkeydown={(e) => e.key === "Enter" && join()}
        />
        <button type="button" class="primary" disabled={!normalizeNickname(nameInput)} onclick={join}>
          Join
        </button>
      </div>
      <button type="button" class="leave" onclick={leaveDocSession}>Cancel</button>
    {:else if docSession.status === "snapshot"}
      <header>
        <span class="title">○ read-only copy</span>
        {#if docSession.docName}<span class="doc">{docSession.docName}</span>{/if}
      </header>
      <p class="hint">{docSession.error ?? "Live session unavailable."}</p>
      <div class="row">
        <button type="button" class="primary" onclick={retryLive}>Retry live</button>
        <button type="button" class="leave" onclick={leaveDocSession}>Dismiss</button>
      </div>
    {:else if docSession.status === "error"}
      <header>
        <span class="title err">live session</span>
      </header>
      <p class="hint err">{docSession.error ?? "Something went wrong."}</p>
      <button type="button" class="leave" onclick={leaveDocSession}>Close</button>
    {:else}
      <header>
        <span class="title {docSession.status}">
          {docSession.status === "connected" ? "● live" : "○ connecting…"}
        </span>
        {#if docSession.docName}
          <span class="doc" title={docSession.docName}>{docSession.docName}</span>
        {:else if docSession.code}
          <span class="code" title="Session code">{docSession.code}</span>
        {/if}
        <button type="button" class="leave" onclick={leaveDocSession}>Leave</button>
      </header>

      {#if docSession.participants.length > 0}
        <ul class="roster">
          {#each docSession.participants as p (p.id)}
            <li>
              {#if p.id === docSession.participantId && renaming}
                <input
                  type="text"
                  class="rename"
                  maxlength="40"
                  bind:value={renameInput}
                  onkeydown={(e) => e.key === "Enter" && applyRename()}
                />
                <button type="button" class="mini" onclick={applyRename}>✓</button>
              {:else}
                <span class="who" class:you={p.id === docSession.participantId}>
                  {p.nickname}{#if p.id === docSession.participantId}&nbsp;(you){/if}
                </span>
                {#if p.role === "viewer"}<span class="badge">viewing</span>{/if}
                {#if p.id === docSession.participantId}
                  <button type="button" class="mini" title="Change your name" onclick={startRename}>
                    ✎
                  </button>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if docSession.editorLink || docSession.viewerLink}
        <div class="row">
          {#if docSession.editorLink}
            <button type="button" onclick={() => copyLink(docSession.editorLink, "Edit")}>
              Copy edit link
            </button>
          {/if}
          {#if docSession.viewerLink}
            <button type="button" onclick={() => copyLink(docSession.viewerLink, "View")}>
              Copy view link
            </button>
          {/if}
        </div>
      {/if}

      {#if docSession.error}
        <p class="hint err">{docSession.error}</p>
      {/if}
    {/if}
  </aside>
{/if}

<style>
  /* Self-contained palette, same convention as Modal/CloudSavesPane. */
  .widget {
    position: fixed;
    left: 1rem;
    bottom: 1rem;
    z-index: 60;
    width: min(20rem, calc(100vw - 2rem));
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    background: #151517;
    border: 1px solid #2e2e34;
    border-radius: 10px;
    padding: 0.7rem 0.8rem;
    font-family: "Barlow", system-ui, sans-serif;
    font-size: 0.8rem;
    color: #a8a8b2;
    box-shadow:
      0 1px 0 0 rgba(255, 255, 255, 0.06) inset,
      0 12px 32px -8px rgba(0, 0, 0, 0.9);
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .title {
    font-family: "Barlow Condensed", system-ui, sans-serif;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
  .title.connected {
    color: #2dd4bf;
  }
  .title.err {
    color: #f87171;
  }
  .doc {
    flex: 1;
    min-width: 0;
    color: #ededf0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .code {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: #ededf0;
    background: #0c0c0e;
    border: 1px solid #2e2e34;
    border-radius: 4px;
    padding: 0.1rem 0.45rem;
  }
  .hint {
    margin: 0;
    font-size: 0.78rem;
    color: #a8a8b2;
  }
  .hint.err {
    color: #f87171;
  }
  .roster {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-height: 9rem;
    overflow-y: auto;
  }
  .roster li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .who {
    color: #ededf0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who.you {
    color: #2dd4bf;
  }
  .badge {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #a8a8b2;
    border: 1px solid #2e2e34;
    border-radius: 999px;
    padding: 0 0.4rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  input {
    flex: 1;
    min-width: 0;
    background: #0c0c0e;
    color: #ededf0;
    border: 1px solid #2e2e34;
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font: inherit;
  }
  input:focus-visible {
    outline: none;
    border-color: #14b8a6;
  }
  input.rename {
    padding: 0.15rem 0.4rem;
    font-size: 0.78rem;
  }
  button {
    background: #1b1b1f;
    color: #ededf0;
    border: 1px solid #66666f;
    border-radius: 6px;
    padding: 0.3rem 0.65rem;
    font: inherit;
    font-size: 0.78rem;
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
  .primary {
    background: #14b8a6;
    color: #04221e;
    border: none;
    font-weight: 600;
  }
  .primary:hover {
    background: #2dd4bf;
  }
  .leave {
    margin-left: auto;
    color: #f87171;
    border-color: #3a2a2a;
  }
  .mini {
    padding: 0 0.35rem;
    font-size: 0.72rem;
    border: none;
    background: none;
    color: #66666f;
  }
  .mini:hover {
    color: #2dd4bf;
  }
</style>
