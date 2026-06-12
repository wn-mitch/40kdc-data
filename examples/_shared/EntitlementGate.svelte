<script lang="ts">
  import Modal from "./Modal.svelte";
  import { connectPatreon, entitlement, redeemKey } from "./entitlement.svelte";

  /**
   * The "become entitled" modal: Connect Patreon (primary) or paste a
   * personally-distributed access key. Mirrors shadowboxing's gate UX. The
   * host opens it whenever a patron feature is used while disconnected.
   */
  interface Props {
    open?: boolean;
    /** What the patron unlocks, for the modal copy (e.g. "cloud sync and short links"). */
    feature: string;
    onClose?: () => void;
  }
  let { open = $bindable(false), feature, onClose }: Props = $props();

  let key = $state("");
  let redeeming = $state(false);

  async function submitKey(): Promise<void> {
    redeeming = true;
    const ok = await redeemKey(key);
    redeeming = false;
    if (ok) {
      key = "";
      open = false;
      onClose?.();
    }
  }
</script>

<Modal bind:open title="Patron feature" {onClose}>
  <div class="gate">
    <p>
      {feature.charAt(0).toUpperCase() + feature.slice(1)} is a patron feature — connect your
      Patreon to unlock it. Opening links others share with you is always free.
    </p>
    <button type="button" class="primary" onclick={connectPatreon}>Connect Patreon</button>
    <div class="divider"><span>or</span></div>
    <label for="access-key">Have an access key?</label>
    <div class="row">
      <input
        id="access-key"
        type="password"
        placeholder="paste access key"
        autocomplete="off"
        bind:value={key}
        onkeydown={(e) => e.key === "Enter" && key.trim() && submitKey()}
      />
      <button type="button" disabled={!key.trim() || redeeming} onclick={submitKey}>
        {redeeming ? "…" : "Redeem"}
      </button>
    </div>
    {#if entitlement.error}
      <p class="error">{entitlement.error}</p>
    {/if}
  </div>
</Modal>

<style>
  /* Self-contained (hardcoded shadowboxing palette) like Modal.svelte, so the
     gate renders identically under Tailwind and plain-CSS hosts. */
  .gate {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  p {
    margin: 0;
    color: #a8a8b2;
    font-size: 0.9rem;
  }
  .primary {
    align-self: flex-start;
    background: #14b8a6;
    color: #04221e;
    border: none;
    border-radius: 6px;
    padding: 0.5rem 1rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:hover {
    background: #2dd4bf;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: #66666f;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    border-top: 1px solid #2e2e34;
  }
  label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #a8a8b2;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  input {
    flex: 1;
    background: #0c0c0e;
    color: #ededf0;
    border: 1px solid #2e2e34;
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
    font: inherit;
    font-size: 0.85rem;
  }
  input:focus-visible {
    outline: none;
    border-color: #14b8a6;
  }
  .row button {
    background: #1b1b1f;
    color: #ededf0;
    border: 1px solid #66666f;
    border-radius: 6px;
    padding: 0.45rem 0.9rem;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .row button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .error {
    color: #f87171;
    font-size: 0.85rem;
  }
</style>
