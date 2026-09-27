import { useState } from "react";

import { api } from "./workbench-api";

type Example = { ability_version_id: number; faction_id: string; ability_id: string; name: string | null; before: string; match: string; after: string };

/**
 * "Show examples": a few current sources where this wording appears, each with its sentence and
 * the wording marked, so the reviewer can check what it means before naming it.
 */
export function Examples({ text, faction, openAbility }: { text: string; faction: string; openAbility?: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ total: number; examples: Example[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || loaded) return;
    const query = new URLSearchParams({ text, limit: "6" });
    if (faction) query.set("faction", faction);
    api<{ total: number; examples: Example[] }>(`/leaves/examples?${query}`).then(setLoaded).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }
  return <div className="wb-examples">
    <button type="button" className="text-button" aria-expanded={open} onClick={toggle}>{open ? "Hide examples" : "Show examples"}</button>
    {open && (error ? <small className="error">{error}</small> : !loaded ? <small>Loading examples…</small> : <>
      <ul>{loaded.examples.map((example) => <li key={`${example.ability_version_id}:${example.before.length}`}>
        <small><strong>{example.name ?? example.ability_id}</strong> · {example.faction_id}
          {openAbility && <> · <button type="button" className="text-button" onClick={() => openAbility(example.ability_version_id)}>Open</button></>}</small>
        <p>{example.before}<mark>{example.match}</mark>{example.after}</p>
      </li>)}</ul>
      <small>{loaded.total === 0 ? "No current source has this wording." : `${loaded.examples.length} of ${loaded.total} occurrence${loaded.total === 1 ? "" : "s"}.`}</small>
    </>)}
  </div>;
}
