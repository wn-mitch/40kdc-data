<script lang="ts">
  import { entitlement } from "./entitlement.svelte";

  /**
   * Header-sized account state for AppHeader's `nav` snippet: "Sign in" when
   * disconnected (the host pops the entitlement gate), or a cloud chip that
   * opens the host's cloud-saves view. Access-key identities get the honest
   * "shared key" pill — keys are personal; everyone holding one shares the
   * same cloud space.
   */
  interface Props {
    onSignIn: () => void;
    onOpenCloud: () => void;
  }
  let { onSignIn, onOpenCloud }: Props = $props();

  /** A friendly identity label: key labels for access keys, else "Patreon"
   *  (Patreon subs are opaque numeric ids — not worth showing). */
  const label = $derived(
    entitlement.shared && entitlement.sub ? entitlement.sub.slice("key:".length) : "Patreon",
  );
</script>

{#if entitlement.connected}
  <button
    type="button"
    class="chip connected"
    title={`Cloud saves — signed in${entitlement.sub ? ` as ${entitlement.sub}` : ""}`}
    onclick={onOpenCloud}
  >
    <span class="dot" aria-hidden="true"></span>
    <span class="label">{label}</span>
    {#if entitlement.shared}
      <span
        class="pill"
        title="This identity comes from an access key — everyone holding it shares one cloud space. Keys are personal; please don't redistribute them."
      >
        shared key
      </span>
    {/if}
  </button>
{:else}
  <button type="button" class="chip" onclick={onSignIn}>Sign in</button>
{/if}

<style>
  /* Self-contained palette, same convention as Modal/CloudSavesPane. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: #1b1b1f;
    color: #ededf0;
    border: 1px solid #66666f;
    border-radius: 999px;
    padding: 0.25rem 0.75rem;
    font-family: "Barlow", system-ui, sans-serif;
    font-size: 0.78rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .chip:hover {
    border-color: #14b8a6;
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: #2dd4bf;
    flex: 0 0 auto;
  }
  .label {
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pill {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #a8a8b2;
    border: 1px solid #2e2e34;
    border-radius: 999px;
    padding: 0 0.4rem;
  }
</style>
