<script lang="ts">
import { onMount } from "svelte";
import { ds } from "$lib/data/dataset";
import ArmyBuilder from "$lib/components/game/builder/ArmyBuilder.svelte";
import {
	rosterTextToBuilderState,
	shareListToBuilderState,
	type BuilderState,
} from "$lib/data/builder";
import { decodeShareToken } from "@alpaca-software/40kdc-data";
import { decodeShareLink } from "$lib/data/share-link";
import AppHeader from "../../_shared/AppHeader.svelte";
import AppFooter from "../../_shared/AppFooter.svelte";
import EntitlementGate from "../../_shared/EntitlementGate.svelte";
import CloudSavesPane from "../../_shared/CloudSavesPane.svelte";
import { maybeCaptureEntitlement } from "../../_shared/entitlement.svelte";
import { resolveLink } from "../../_shared/sync-api";
import {
	SALVO_URL,
	MISSION_MATRIX_URL,
	LAYOUT_EDITOR_URL,
} from "../../_shared/links.js";

/**
 * Standalone shell around the lifted `ArmyBuilder`. In the host Shadowboxing
 * app this role is played by `ArmyLibraryModal`, which persists through the
 * Rust/WASM bridge; here there is no host, so the shell owns its own saved-list
 * state in `localStorage` and lowers a finished draft to roster-json that it
 * copies to the clipboard and offers as a download. The builder itself is
 * untouched — it still just calls `onsave(rosterJson, name, disposition)`.
 */

interface SavedEntry {
	id: string;
	name: string;
	/** Canonical roster-json the builder emitted — round-trips back via import. */
	rosterJson: string;
	disposition: string | null;
	/** Epoch ms of the last save, for display + sort. */
	modified: number;
}

const STORAGE_KEY = "list-builder:saved";

function loadEntries(): SavedEntry[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		// Defensive: keep only well-shaped rows so a corrupt key can't blank the UI.
		return parsed.filter(
			(e): e is SavedEntry =>
				e && typeof e.id === "string" && typeof e.rosterJson === "string",
		);
	} catch {
		return [];
	}
}

function persist(next: SavedEntry[]) {
	entries = next;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		toast = "Couldn't save to local storage (quota or private mode).";
	}
}

let entries = $state<SavedEntry[]>(loadEntries());
let view = $state<"list" | "build">("list");
/** Seed for "Edit"; undefined for a from-scratch build. */
let seed = $state<BuilderState | undefined>(undefined);
/** The entry being edited (null = new build → save creates a row). */
let editingId = $state<string | null>(null);
let importText = $state("");
let importError = $state<string | null>(null);
let toast = $state<string | null>(null);
let gateOpen = $state(false);

const sorted = $derived(entries.slice().sort((a, b) => b.modified - a.modified));

/** Saved lists as cloud-uploadable items (payload = parsed roster-json, the
 *  same canonical object a shortlink consumer feeds back into an importer). */
const cloudItems = $derived(
	sorted.flatMap((e) => {
		try {
			return [{ name: e.name, payload: JSON.parse(e.rosterJson) as unknown }];
		} catch {
			return [];
		}
	}),
);

/** Open a canonical roster payload (cloud doc or shortlink) in the builder. */
function openRosterPayload(payload: unknown, name: string): void {
	const state = rosterTextToBuilderState(JSON.stringify(payload), name, null);
	if (!state) {
		flash("That roster couldn't be opened.");
		return;
	}
	seed = state;
	editingId = null;
	view = "build";
}

// Open a shared list from the URL. The current format is `#l=<share-v1 token>`
// (compact, registry-indexed); `#list=<gzip roster-json>` is the legacy form,
// still honoured so old links keep working. Decoded client-side (no backend),
// then the hash is cleared so refresh/save can't re-trigger the import.
onMount(() => {
	// The OAuth callback may have delivered an entitlement token in the
	// fragment — capture it before any gated UI reads the stored state.
	maybeCaptureEntitlement();

	// Open a `?s=CODE` shortlink (server-resolved; opening is free).
	const code = new URLSearchParams(location.search).get("s");
	if (code) {
		void resolveLink(code).then((res) => {
			if (res.ok && res.value.kind === "list") {
				openRosterPayload(res.value.payload, "Shared list");
			} else {
				flash(res.ok ? "That link isn't an army list." : "That short link couldn't be opened.");
			}
		});
		const params = new URLSearchParams(location.search);
		params.delete("s");
		const qs = params.toString();
		history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
	}

	const compact = location.hash.match(/^#l=(.+)$/);
	const legacy = location.hash.match(/^#list=(.+)$/);
	if (!compact && !legacy) return;

	let state: BuilderState | null = null;
	let staleLink = false;
	if (compact) {
		const result = decodeShareToken(compact[1]);
		if (result.ok) state = shareListToBuilderState(result.list);
		else staleLink = result.reason === "stale-registry";
	} else if (legacy) {
		const json = decodeShareLink(legacy[1]);
		state = json ? rosterTextToBuilderState(json, "Shared list", null) : null;
	}

	if (state) {
		seed = state;
		editingId = null;
		view = "build";
	} else if (staleLink) {
		flash("That share link was made with a newer dataset — update to open it.");
	} else {
		flash("That share link couldn't be opened.");
	}
	history.replaceState(null, "", location.pathname + location.search);
});

function flash(msg: string) {
	toast = msg;
	setTimeout(() => {
		if (toast === msg) toast = null;
	}, 4000);
}

function dispositionName(id: string | null): string {
	return id ? (ds.forceDispositions.get(id)?.name ?? id) : "—";
}

function factionLabel(rosterJson: string): string {
	// Cheap peek at the stored roster for a list-row subtitle; the builder is the
	// source of truth, this is display-only so a parse miss just shows nothing.
	try {
		const r = JSON.parse(rosterJson);
		const dets = (r.detachments ?? []).map((d: any) => d?.ref?.id ?? d?.ref?.raw_name);
		return [r.faction_id, ...dets].filter(Boolean).join(" · ");
	} catch {
		return "";
	}
}

// ── Navigation ────────────────────────────────────────────────────────────────

function newList() {
	seed = undefined;
	editingId = null;
	importError = null;
	view = "build";
}

function editEntry(entry: SavedEntry) {
	const state = rosterTextToBuilderState(entry.rosterJson, entry.name, entry.disposition);
	if (!state) {
		flash(`"${entry.name}" couldn't be re-opened (its roster text won't import).`);
		return;
	}
	seed = state;
	editingId = entry.id;
	view = "build";
}

function importList() {
	const text = importText.trim();
	if (!text) return;
	const state = rosterTextToBuilderState(text, "Imported list", null);
	if (!state) {
		importError = "Couldn't import that text — paste a roster-json (or any supported roster format).";
		return;
	}
	seed = state;
	editingId = null;
	importText = "";
	importError = null;
	view = "build";
}

function deleteEntry(id: string) {
	persist(entries.filter((e) => e.id !== id));
}

// ── Builder callbacks ───────────────────────────────────────────────────────────

function handleSave(rosterJson: string, name: string, disposition: string | null) {
	const now = Date.now();
	if (editingId) {
		persist(
			entries.map((e) =>
				e.id === editingId ? { ...e, name, rosterJson, disposition, modified: now } : e,
			),
		);
	} else {
		const id =
			typeof crypto !== "undefined" && crypto.randomUUID
				? crypto.randomUUID()
				: `list-${now}-${Math.floor(Math.random() * 1e6)}`;
		persist([...entries, { id, name, rosterJson, disposition, modified: now }]);
	}
	copyToClipboard(rosterJson);
	downloadJson(rosterJson, name);
	flash(`Saved “${name}” — roster-json copied to clipboard & downloaded.`);
	view = "list";
	seed = undefined;
	editingId = null;
}

function handleCancel() {
	view = "list";
	seed = undefined;
	editingId = null;
}

function copyToClipboard(text: string) {
	navigator.clipboard?.writeText(text).catch(() => {
		/* clipboard may be blocked (non-secure context) — the download is the fallback. */
	});
}

function downloadJson(text: string, name: string) {
	const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "army-list";
	const blob = new Blob([text], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${slug}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

function copyEntry(entry: SavedEntry) {
	copyToClipboard(entry.rosterJson);
	flash(`Copied “${entry.name}” roster-json to clipboard.`);
}
</script>

<div class="flex h-screen flex-col">
	<AppHeader title="List Builder" tag="40kdc army list builder" onBrand={handleCancel} />

	<main class="min-h-0 flex-1 overflow-hidden p-3">
		{#if view === "build"}
			<ArmyBuilder initial={seed} onsave={handleSave} oncancel={handleCancel} />
		{:else}
			<div class="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto">
				<div class="flex items-center justify-between">
					<h2 class="font-heading text-text text-xl font-bold uppercase tracking-wider">
						Saved lists
					</h2>
					<button
						class="bg-accent text-accent-foreground hover:bg-accent-hover rounded px-4 py-1.5 text-sm font-semibold transition-colors"
						onclick={newList}>+ New list</button
					>
				</div>

				<!-- Saved-list rows (most-recent first). -->
				{#if sorted.length === 0}
					<p class="text-text-dim rounded border border-dashed border-white/10 p-6 text-center text-sm italic">
						No saved lists yet. Start a new build, or import an existing roster below.
					</p>
				{:else}
					<ul class="flex flex-col gap-1.5">
						{#each sorted as entry (entry.id)}
							<li
								class="bg-panel-surface border-panel-border flex items-center gap-2 rounded border px-3 py-2"
							>
								<button class="flex min-w-0 flex-1 flex-col text-left" onclick={() => editEntry(entry)}>
									<span class="text-text truncate text-sm font-medium">{entry.name}</span>
									<span class="text-text-dim/70 truncate text-[11px]">
										{factionLabel(entry.rosterJson)}
										{#if entry.disposition}· {dispositionName(entry.disposition)}{/if}
									</span>
								</button>
								<button
									class="text-text-dim hover:text-text shrink-0 text-xs"
									onclick={() => editEntry(entry)}>Edit</button
								>
								<button
									class="text-text-dim hover:text-text shrink-0 text-xs"
									onclick={() => copyEntry(entry)}
									title="Copy roster-json to clipboard">Copy</button
								>
								<button
									class="text-text-dim shrink-0 text-xs hover:text-red-400"
									onclick={() => deleteEntry(entry.id)}
									aria-label="delete list">×</button
								>
							</li>
						{/each}
					</ul>
				{/if}

				<!-- Cloud sync + short links (patron feature; opening links is free). -->
				<CloudSavesPane
					kind="list"
					localItems={cloudItems}
					onOpen={(name, payload) => openRosterPayload(payload, name)}
					onFlash={flash}
					onNeedEntitlement={() => (gateOpen = true)}
				/>

				<!-- Import an existing roster (roster-json or any supported format). -->
				<div class="border-panel-border/50 mt-2 flex flex-col gap-2 border-t pt-4">
					<label class="text-text-dim text-[10px] font-semibold uppercase tracking-wider" for="import-box">
						Import a roster
					</label>
					<textarea
						id="import-box"
						class="bg-panel border-panel-border text-text h-28 w-full resize-y rounded border p-2 font-mono text-xs"
						placeholder="Paste roster-json (or a NewRecruit / ListForge export) here…"
						bind:value={importText}
					></textarea>
					{#if importError}
						<span class="text-[11px] text-red-400">{importError}</span>
					{/if}
					<div>
						<button
							class="bg-panel-surface border-panel-border text-text hover:border-panel-border/80 rounded border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
							disabled={!importText.trim()}
							onclick={importList}>Import & edit</button
						>
					</div>
				</div>
			</div>
		{/if}
	</main>

	{#if toast}
		<div
			class="bg-accent text-accent-foreground pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded px-4 py-2 text-sm font-medium shadow-md"
			role="status"
		>
			{toast}
		</div>
	{/if}

	<AppFooter
		links={[
			{ label: "Salvo", href: SALVO_URL },
			{ label: "Mission Matrix", href: MISSION_MATRIX_URL },
			{ label: "Terrain layouts", href: LAYOUT_EDITOR_URL },
		]}
		version={__DATA_VERSION__}
		build={__BUILD_SHA__}
	/>

	<EntitlementGate bind:open={gateOpen} feature="cloud sync and short links" />
</div>
