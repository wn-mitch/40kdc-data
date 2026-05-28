<script lang="ts">
  import {
    salvo,
    ds,
    MANUAL_BUFF_TOGGLES,
    CONTEXT_FLAG_TOGGLES,
  } from "./store.svelte.js";
  import type {
    Buff,
    EngineContext,
    StackableBuff,
    StackableBuffGroup,
  } from "@alpaca-software/40kdc-data";

  // EngineContext for the DSL→Buff translator. Without this the translator
  // defaults to `{ phase: "shooting" }`, so phase-gated branches misfire when
  // the fight tab is open.
  const attackerKeywords = $derived.by<string[]>(() => {
    if (!salvo.selectedUnitId) return [];
    const u = ds.units.get(salvo.selectedUnitId);
    if (!u) return [];
    return [
      ...((u.raw.keywords ?? []) as string[]),
      ...((u.raw.faction_keywords ?? []) as string[]),
    ].map((k) => k.toLowerCase());
  });

  const engineContext = $derived<EngineContext>({
    phase: salvo.phase,
    attackerStationary: salvo.contextFlags.attackerStationary,
    withinHalfRange: salvo.contextFlags.withinHalfRange,
    attackerKeywords,
    targetKeywords: salvo.manualTarget.keywords.map((k) => k.toLowerCase()),
  });

  // Every buff the attacker could stack, as toggleable levers. The package
  // does the DSL walk once and hands back (buff, enabled) pairs plus the
  // activation groups (dice-pool / choice) that cap how many fire at once.
  const stackable = $derived.by<{ buffs: StackableBuff[]; groups: StackableBuffGroup[] }>(() => {
    if (!salvo.selectedUnitId) return { buffs: [], groups: [] };
    try {
      return ds.stackableBuffsFor(
        {
          unitId: salvo.selectedUnitId,
          factionId: salvo.selectedFactionId ?? undefined,
          detachmentId: salvo.selectedDetachmentId ?? undefined,
          attachedLeaderId: salvo.attachedLeaderId ?? undefined,
          weaponProfiles: salvo.selectedWeaponId
            ? [{ weaponId: salvo.selectedWeaponId, profileIndex: salvo.selectedProfileIndex }]
            : [],
        },
        engineContext,
      );
    } catch {
      return { buffs: [], groups: [] };
    }
  });

  // Free-standing levers (always-on abilities, stratagems, weapon keywords).
  const ungrouped = $derived(stackable.buffs.filter((b) => !b.group));

  // Levers that belong to a capped activation pool (e.g. Blessings of Khorne).
  const pools = $derived.by(() => {
    const byGroup = new Map<string, StackableBuff[]>();
    for (const b of stackable.buffs) {
      if (!b.group) continue;
      const list = byGroup.get(b.group) ?? [];
      list.push(b);
      byGroup.set(b.group, list);
    }
    return stackable.groups
      .map((g) => ({ group: g, levers: byGroup.get(g.id) ?? [] }))
      .filter((p) => p.levers.length > 0);
  });

  function enabled(b: StackableBuff): boolean {
    return salvo.isBuffEnabled(b.id, b.enabled);
  }

  function activeInGroup(groupId: string): number {
    return stackable.buffs.filter((b) => b.group === groupId && enabled(b)).length;
  }

  function toggle(b: StackableBuff) {
    salvo.setBuffEnabled(b.id, !enabled(b));
  }

  function toggleManual(id: string) {
    const next = new Set(salvo.manualBuffsActive);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    salvo.manualBuffsActive = next;
  }

  function sourceChip(b: StackableBuff): string {
    if (b.source.kind === "weapon-keyword") return "weapon";
    if (b.source.kind === "manual") return "manual";
    return b.source.abilityKind === "detachment-stratagem" ? "stratagem" : b.source.abilityKind;
  }

  function describeBuff(b: Buff): string {
    const c = b.contribution;
    if (c.type === "extra-keyword") {
      const v = c.keywordRef.parameters?.value;
      return `${c.keywordRef.keyword_id}${typeof v === "number" ? ` ${v}` : ""}`;
    }
    return "value" in c ? `${c.type} ${c.value}` : c.type;
  }

  function summary(b: StackableBuff): string {
    return b.buffs.map(describeBuff).join(", ") || "no effect";
  }
</script>

{#if !salvo.selectedUnitId}
  <p class="dim" style="font-size:12px">Pick an attacker unit to see eligible buffs.</p>
{:else if stackable.buffs.length === 0}
  <p class="dim" style="font-size:12px">No buffs available in the {salvo.phase} phase.</p>
{:else}
  <div class="ability-list">
    {#each ungrouped as b (b.id)}
      <label class="ability-row" class:active={enabled(b)}>
        <input type="checkbox" checked={enabled(b)} onchange={() => toggle(b)} />
        <span class="name">
          {b.label}
          <small>· {summary(b)}</small>
        </span>
        <span class="chip {sourceChip(b)}">{sourceChip(b)}</span>
      </label>
    {/each}

    {#each pools as p (p.group.id)}
      <div
        style="margin-top:8px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em"
      >
        {p.group.label} · pick up to {p.group.maxActivations}
        ({activeInGroup(p.group.id)}/{p.group.maxActivations})
      </div>
      {#each p.levers as b (b.id)}
        {@const atCap =
          !enabled(b) && activeInGroup(p.group.id) >= p.group.maxActivations}
        <label class="ability-row" class:active={enabled(b)} class:dim={atCap}>
          <input
            type="checkbox"
            checked={enabled(b)}
            disabled={atCap}
            onchange={() => toggle(b)}
          />
          <span class="name">
            {b.label}
            <small>· {summary(b)}</small>
          </span>
          <span class="chip activation">activation</span>
        </label>
      {/each}
    {/each}
  </div>
{/if}

<hr style="border:0;border-top:1px solid var(--border);margin:14px 0" />

<div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">
  Manual toggles
</div>
<div class="ability-list">
  {#each MANUAL_BUFF_TOGGLES as t (t.id)}
    <label class="ability-row" class:active={salvo.manualBuffsActive.has(t.id)}>
      <input
        type="checkbox"
        checked={salvo.manualBuffsActive.has(t.id)}
        onchange={() => toggleManual(t.id)}
      />
      <span class="name">{t.label}</span>
      <span class="chip manual">manual</span>
    </label>
  {/each}
  {#each CONTEXT_FLAG_TOGGLES as t (t.id)}
    <label class="ability-row" class:active={salvo.contextFlags[t.id]}>
      <input
        type="checkbox"
        checked={salvo.contextFlags[t.id]}
        onchange={(e) =>
          (salvo.contextFlags = {
            ...salvo.contextFlags,
            [t.id]: (e.currentTarget as HTMLInputElement).checked,
          })}
      />
      <span class="name">{t.label}</span>
      <span class="chip manual">context</span>
    </label>
  {/each}
</div>
