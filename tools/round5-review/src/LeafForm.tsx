import { useState } from "react";

/** One reviewed family as the bridge lists it (deprecated versions are never listed). */
export type Family = {
  id: string; version: number; role: string; label: string; description: string;
  starter: Record<string, unknown>;
  parameterSchema: { properties?: Record<string, Property> };
};
type Property = { enum?: string[]; anyOf?: Property[]; type?: string; pattern?: string };

const ROLE_LABELS: Record<string, string> = {
  CONDITION: "Condition: when it applies", EVENT: "Event: when it fires", EFFECT: "Effect: what changes", DURATION: "Duration: how long",
};

function choices(property: Property): string[] {
  return property.enum ?? property.anyOf?.flatMap((item) => item.enum ?? []) ?? [];
}
const sourceable = (property: Property) => property.anyOf?.some((item) => item.type === "object") ?? false;
const numeric = (property: Property) => property.type === "integer" || (property.anyOf?.some((item) => item.type === "integer") ?? false);
const freeText = (property: Property) => property.anyOf?.some((item) => item.type === "string") ?? property.type === "string";

/** A short, readable name for a leaf: its family label and parameters. */
export function leafLabel(families: readonly Family[], familyId: string, parameters: Record<string, unknown>): string {
  const family = families.find((item) => item.id === familyId);
  const values = Object.entries(parameters).map(([key, value]) =>
    `${key.replaceAll("_", " ")} ${value && typeof value === "object" && "source" in value ? `“${String(value.source)}”` : String(value)}`);
  return `${family?.label ?? familyId}${values.length ? ` · ${values.join(" · ")}` : ""}`;
}

/**
 * Choose what source wording means: a reviewed family and its parameters. Parameters that
 * accept exact source words offer that as a choice; everything else is a closed list or number.
 */
export function LeafForm({ families, exactText, role, initial, busy, submitLabel, onSubmit, onCancel }: {
  families: readonly Family[];
  exactText: string;
  role?: string | null;
  initial?: { family_id: string; parameters: Record<string, unknown> };
  busy: boolean;
  submitLabel: string;
  onSubmit: (familyId: string, parameters: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [familyId, setFamilyId] = useState(initial?.family_id ?? "");
  const [parameters, setParameters] = useState<Record<string, unknown>>(initial?.parameters ?? {});
  const family = families.find((item) => item.id === familyId);
  const properties = family?.parameterSchema.properties ?? {};
  const choose = (id: string) => {
    setFamilyId(id);
    setParameters(structuredClone(families.find((item) => item.id === id)?.starter ?? {}));
  };
  const set = (name: string, value: unknown) => setParameters((current) => ({ ...current, [name]: value }));
  const complete = family && Object.keys(properties).every((name) => {
    const value = parameters[name];
    return value !== "" && value !== null && value !== undefined
      && !(typeof value === "object" && "source" in value && !String((value as { source: unknown }).source).trim());
  });
  const roles = role ? [role] : Object.keys(ROLE_LABELS);
  return <form className="wb-leaf-form" onSubmit={(event) => { event.preventDefault(); if (complete) onSubmit(familyId, parameters); }}>
    <label>Meaning<select value={familyId} onChange={(event) => choose(event.target.value)}>
      <option value="">Choose what this wording means</option>
      {roles.map((item) => <optgroup key={item} label={ROLE_LABELS[item] ?? item}>
        {families.filter((candidate) => candidate.role === item).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
      </optgroup>)}
    </select></label>
    {family && <p className="wb-help">{family.description}</p>}
    <div className="wb-editor-grid">{Object.entries(properties).map(([name, property]) => {
      const value = parameters[name];
      const options = choices(property);
      const label = name.replaceAll("_", " ");
      const isSource = value !== null && typeof value === "object" && "source" in value;
      if (freeText(property)) {
        return <label key={name}>{label}<input list={`wb-${name}-choices`} value={typeof value === "string" ? value : ""} onChange={(event) => set(name, event.target.value)} />
          <datalist id={`wb-${name}-choices`}>{options.map((option) => <option key={option} value={option} />)}</datalist></label>;
      }
      if (options.length) {
        return <label key={name}>{label}<select value={isSource ? "__source" : typeof value === "string" ? value : ""}
          onChange={(event) => set(name, event.target.value === "__source" ? { source: exactText } : event.target.value)}>
          <option value="">Choose {label}</option>
          {options.map((option) => <option key={option} value={option}>{option.replaceAll("-", " ")}</option>)}
          {sourceable(property) && <option value="__source">Exact words from the source…</option>}
        </select>
          {isSource && <input value={String((value as { source: unknown }).source)} onChange={(event) => set(name, { source: event.target.value })} aria-label={`${label} source words`} />}
        </label>;
      }
      if (numeric(property)) {
        return <label key={name}>{label}<input type="number" step={1} value={typeof value === "number" ? value : ""}
          onChange={(event) => set(name, event.target.value === "" ? null : Number(event.target.value))} /></label>;
      }
      return <label key={name}>{label}<input value={isSource ? String((value as { source: unknown }).source) : ""} onChange={(event) => set(name, { source: event.target.value })} placeholder="Exact words from the source" /></label>;
    })}</div>
    <div className="wb-actions">
      <button className="primary" type="submit" disabled={busy || !complete}>{submitLabel}</button>
      <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
