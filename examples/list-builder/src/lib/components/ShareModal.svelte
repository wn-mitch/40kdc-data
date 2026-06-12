<script lang="ts">
	import Modal from "../../../../_shared/Modal.svelte";
	import EntitlementGate from "../../../../_shared/EntitlementGate.svelte";
	import { entitlement, storedEntitlement } from "../../../../_shared/entitlement.svelte";
	import { mintLink, shortlinkUrl } from "../../../../_shared/sync-api";
	import { exportRoster, encodeShareToken, type Roster, type ExportFormat } from "@alpaca-software/40kdc-data";
	import { builderStateToShareList, type BuilderState } from "../data/builder";

	interface Props {
		/** Bindable visibility, driven by the host. */
		open?: boolean;
		/** The list to share; null while the modal is closed / no draft. */
		roster: Roster | null;
		/** The working draft — the share link encodes this (lossless), not the roster. */
		draft: BuilderState | null;
		onClose?: () => void;
	}
	let { open = $bindable(false), roster, draft, onClose }: Props = $props();

	const FORMATS: { id: ExportFormat; label: string }[] = [
		{ id: "newrecruit-wtc-compact", label: "WTC — compact" },
		{ id: "newrecruit-wtc-full", label: "WTC — full" },
		{ id: "newrecruit-simple", label: "Simple text" },
		{ id: "newrecruit-json", label: "NewRecruit JSON" },
		{ id: "rosterizer", label: "Rosterizer JSON" },
		{ id: "roster-json", label: "Roster JSON (canonical)" },
	];

	let format = $state<ExportFormat>("newrecruit-wtc-compact");

	function safeExport(r: Roster, f: ExportFormat): string {
		try {
			return exportRoster(r, f);
		} catch (e) {
			return `// couldn't export as ${f}: ${(e as Error).message}`;
		}
	}

	const exportText = $derived(roster ? safeExport(roster, format) : "");
	const shareLink = $derived(
		draft
			? `${location.origin}${location.pathname}#l=${encodeShareToken(builderStateToShareList(draft))}`
			: "",
	);

	// ── Short link (patron feature) ────────────────────────────────────────────
	let gateOpen = $state(false);
	let shortUrl = $state<string | null>(null);
	let shortError = $state<string | null>(null);
	let minting = $state(false);

	// A new draft invalidates a previously minted link.
	$effect(() => {
		void roster;
		shortUrl = null;
		shortError = null;
	});

	async function mintShortLink(): Promise<void> {
		const token = storedEntitlement();
		if (!token) {
			gateOpen = true;
			return;
		}
		if (!roster) return;
		minting = true;
		shortError = null;
		try {
			// The link stores the canonical roster-json object — the same payload
			// the builder (and shadowboxing's importer) round-trips.
			const payload = JSON.parse(exportRoster(roster, "roster-json"));
			const res = await mintLink(token, "list", payload);
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

	// Transient "Copied!" feedback, keyed by which button was used.
	let copied = $state<"text" | "link" | "short" | null>(null);
	function copy(kind: "text" | "link" | "short", value: string): void {
		navigator.clipboard
			?.writeText(value)
			.then(() => {
				copied = kind;
				setTimeout(() => {
					if (copied === kind) copied = null;
				}, 1500);
			})
			.catch(() => {
				/* clipboard blocked (non-secure context) — the field is selectable as fallback */
			});
	}
</script>

<Modal bind:open title="Share list" {onClose}>
	<div class="flex flex-col gap-4 text-sm">
		<!-- Text export in any supported format. -->
		<div class="flex flex-col gap-1.5">
			<div class="flex items-center justify-between gap-2">
				<label class="text-text-dim text-[10px] font-semibold uppercase tracking-wider" for="share-format">
					Export as
				</label>
				<select
					id="share-format"
					class="bg-panel border-panel-border text-text rounded border px-1.5 py-1 text-xs"
					bind:value={format}
				>
					{#each FORMATS as f (f.id)}
						<option value={f.id}>{f.label}</option>
					{/each}
				</select>
			</div>
			<textarea
				readonly
				class="bg-panel border-panel-border text-text h-40 w-full resize-y rounded border p-2 font-mono text-xs"
				value={exportText}
			></textarea>
			<div>
				<button
					class="bg-panel-surface border-panel-border text-text hover:border-panel-border/80 rounded border px-3 py-1.5 text-xs font-medium transition-colors"
					onclick={() => copy("text", exportText)}
				>
					{copied === "text" ? "Copied!" : "Copy text"}
				</button>
			</div>
		</div>

		<!-- Backend-free share link: the whole list is packed into the URL. -->
		<div class="border-panel-border/50 flex flex-col gap-1.5 border-t pt-3">
			<span class="text-text-dim text-[10px] font-semibold uppercase tracking-wider">Share link</span>
			<p class="text-text-dim/70 text-[11px]">
				The entire list is compressed into the link — no server involved. Opening it loads this list
				in the builder.
			</p>
			<input
				readonly
				class="bg-panel border-panel-border text-text w-full rounded border p-2 font-mono text-[11px]"
				value={shareLink}
				onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
			/>
			<div>
				<button
					class="bg-accent text-accent-foreground hover:bg-accent-hover rounded px-3 py-1.5 text-xs font-semibold transition-colors"
					onclick={() => copy("link", shareLink)}
				>
					{copied === "link" ? "Copied!" : "Copy share link"}
				</button>
			</div>
		</div>

		<!-- Server-backed short link (patron feature; opening it is free, and it
		     pastes straight into shadowboxing's importer too). -->
		<div class="border-panel-border/50 flex flex-col gap-1.5 border-t pt-3">
			<span class="text-text-dim text-[10px] font-semibold uppercase tracking-wider">
				Short link <span class="text-accent normal-case">· patron</span>
			</span>
			{#if shortUrl}
				<input
					readonly
					class="bg-panel border-panel-border text-text w-full rounded border p-2 font-mono text-[11px]"
					value={shortUrl}
					onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
				/>
				<div>
					<button
						class="bg-accent text-accent-foreground hover:bg-accent-hover rounded px-3 py-1.5 text-xs font-semibold transition-colors"
						onclick={() => copy("short", shortUrl ?? "")}
					>
						{copied === "short" ? "Copied!" : "Copy short link"}
					</button>
				</div>
			{:else}
				<div>
					<button
						class="bg-panel-surface border-panel-border text-text hover:border-panel-border/80 rounded border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
						disabled={minting || !roster}
						onclick={mintShortLink}
					>
						{minting ? "Minting…" : entitlement.connected ? "Mint short link" : "Mint short link (connect Patreon)"}
					</button>
				</div>
			{/if}
			{#if shortError}
				<span class="text-[11px] text-red-400">{shortError}</span>
			{/if}
		</div>
	</div>
</Modal>

<EntitlementGate bind:open={gateOpen} feature="short links" />
