<script lang="ts">
  import Modal from "../../../_shared/Modal.svelte";
  import { entitlement, storedEntitlement } from "../../../_shared/entitlement.svelte";
  import { mintLink, shortlinkUrl } from "../../../_shared/sync-api";
  import { encodePlan } from "./share-plan";
  import type { TeamPlan } from "./coverage";

  /**
   * Share dialog: both link kinds side by side. Left, the quick link — the
   * whole plan gzip-packed into a `#t=` fragment, serverless, works for
   * anyone forever. Right, the short link — a tidy server-backed `?s=CODE`
   * (patron feature to mint, free to open), the same payload shape the cloud
   * pane uploads. Mirrors list-builder's ShareModal mint/error handling.
   */
  interface Props {
    open?: boolean;
    plan: TeamPlan;
    onFlash: (msg: string) => void;
    /** Mint attempted without a stored entitlement → host opens the gate. */
    onNeedEntitlement: () => void;
  }
  let { open = $bindable(false), plan, onFlash, onNeedEntitlement }: Props = $props();

  const quickLink = $derived(`${location.origin}${location.pathname}#t=${encodePlan(plan)}`);

  let shortUrl = $state<string | null>(null);
  let shortError = $state<string | null>(null);
  let minting = $state(false);

  // Any plan edit invalidates a previously minted link.
  $effect(() => {
    void plan;
    shortUrl = null;
    shortError = null;
  });

  let copied = $state<"quick" | "short" | null>(null);
  function copy(kind: "quick" | "short", value: string): void {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        copied = kind;
        setTimeout(() => {
          if (copied === kind) copied = null;
        }, 1500);
      })
      .catch(() => {
        /* clipboard blocked — the field is selectable as fallback */
      });
  }

  async function mintShortLink(): Promise<void> {
    const token = storedEntitlement();
    if (!token) {
      onNeedEntitlement();
      return;
    }
    minting = true;
    shortError = null;
    try {
      // Storage-shaped plan — the same payload the ?s= open path sanitizes.
      const res = await mintLink(token, "team-plan", $state.snapshot(plan));
      if (res.ok) {
        shortUrl = shortlinkUrl(location.origin, location.pathname, res.value);
        copy("short", shortUrl);
      } else {
        shortError =
          res.error === "link_quota_exceeded"
            ? "Short-link quota reached — delete some cloud saves/links first."
            : `Couldn't mint a short link (${res.error}).`;
      }
    } catch (e) {
      shortError = e instanceof Error ? e.message : "Couldn't mint a short link.";
    } finally {
      minting = false;
    }
  }
</script>

<Modal bind:open title="Share plan">
  <div class="grid gap-4 text-sm sm:grid-cols-2">
    <!-- Quick link: serverless, always works. -->
    <section class="flex flex-col gap-1.5">
      <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim">
        Quick link
      </span>
      <p class="min-h-8 text-[11px] text-text-dim">
        The whole plan is packed into the link — no account, works anywhere.
      </p>
      <input
        readonly
        class="w-full rounded border border-border-strong bg-panel p-2 font-mono text-[11px] text-text"
        value={quickLink}
        onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
      />
      <div>
        <button
          type="button"
          class="focus-ring rounded bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground hover:bg-accent-hover"
          onclick={() => copy("quick", quickLink)}
        >
          {copied === "quick" ? "Copied!" : "Copy link"}
        </button>
      </div>
    </section>

    <!-- Short link: server-backed, patron-minted, free to open. -->
    <section class="flex flex-col gap-1.5 border-t border-panel-border pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
      <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim">
        Short link <span class="normal-case text-accent">· patron</span>
      </span>
      <p class="min-h-8 text-[11px] text-text-dim">
        A tidy server-backed link. Minting needs a connected Patreon — opening it is free.
      </p>
      {#if shortUrl}
        <input
          readonly
          class="w-full rounded border border-border-strong bg-panel p-2 font-mono text-[11px] text-text"
          value={shortUrl}
          onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        />
        <div>
          <button
            type="button"
            class="focus-ring rounded bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground hover:bg-accent-hover"
            onclick={() => copy("short", shortUrl ?? "")}
          >
            {copied === "short" ? "Copied!" : "Copy short link"}
          </button>
        </div>
      {:else}
        <div>
          <button
            type="button"
            class="focus-ring rounded border border-border-strong bg-panel-surface px-3 py-1.5 text-xs font-medium text-text hover:border-accent disabled:opacity-40"
            disabled={minting}
            onclick={mintShortLink}
          >
            {minting
              ? "Minting…"
              : entitlement.connected
                ? "Mint short link"
                : "Mint short link (connect Patreon)"}
          </button>
        </div>
        {#if shortError}
          <p class="text-[11px] text-danger">{shortError}</p>
        {/if}
      {/if}
    </section>
  </div>
</Modal>
