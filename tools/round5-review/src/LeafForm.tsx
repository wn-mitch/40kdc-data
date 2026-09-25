import { useState } from "react";

/** One reviewed family as the bridge lists it (deprecated versions are never listed). */
export type Family = {
  id: string; version: number; role: string; label: string; description: string;
  starter: Record<string, unknown>;
  parameterSchema: { properties?: Record<string, Property> };
};
type Property = { enum?: string[]; anyOf?: Property[]; type?: string; pattern?: string; minimum?: number; maximum?: number };

const ROLE_LABELS: Record<string, string> = {
  CONDITION: "Condition: when it applies", EVENT: "Event: when it fires", EFFECT: "Effect: what changes", DURATION: "Duration: how long",
};

function choices(property: Property): string[] {
  return property.enum ?? property.anyOf?.flatMap((item) => item.enum ?? []) ?? [];
}
const sourceable = (property: Property) => property.anyOf?.some((item) => item.type === "object") ?? false;
const numeric = (property: Property) => property.type === "integer" || (property.anyOf?.some((item) => item.type === "integer") ?? false);
const freeText = (property: Property) => property.anyOf?.some((item) => item.type === "string") ?? property.type === "string";

/** Weapon abilities that carry a value, and the values GW prints for them. */
const VALUED_KEYWORDS = ["Sustained Hits", "Rapid Fire", "Melta"] as const;
const KEYWORD_VALUES = ["1", "2", "3", "D3", "D6"] as const;
const titleCase = (text: string) => text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase());

/** The weapon ability named in brackets in the source, spelled the way the DSL spells it. */
function keywordFromSource(exactText: string, options: readonly string[]): string | null {
  const bracketed = /\[([^\]]+)\]/u.exec(exactText)?.[1];
  if (!bracketed) return null;
  const named = options.find((option) => option.toLowerCase() === bracketed.trim().toLowerCase());
  if (named) return named;
  const valued = /^(sustained hits|rapid fire|melta) (\d|d3|d6)$/iu.exec(bracketed.trim());
  return valued ? `${titleCase(valued[1]!)} ${valued[2]!.toUpperCase()}` : null;
}

/** Buttons that act as one radio group; better than a dropdown for a handful of choices. */
function Chips({ label, options, value, onChange, render = (option) => option.replaceAll("-", " ") }: {
  label: string; options: readonly string[]; value: unknown; onChange: (value: string) => void; render?: (option: string) => string;
}) {
  return <div className="wb-chips" role="radiogroup" aria-label={label}>
    {options.map((option) => <button key={option} type="button" role="radio" aria-checked={value === option}
      className={value === option ? "wb-chip wb-chip-on" : "wb-chip"} onClick={() => onChange(option)}>{render(option)}</button>)}
  </div>;
}

/** Pick a named weapon ability, or a valued one as its name plus its value. */
function KeywordPicker({ options, value, onChange }: { options: readonly string[]; value: string; onChange: (value: string) => void }) {
  const valued = VALUED_KEYWORDS.find((base) => value.startsWith(`${base} `)) ?? (VALUED_KEYWORDS as readonly string[]).find((base) => value === base) ?? null;
  const amount = valued ? value.slice(valued.length + 1) : "";
  return <div className="wb-keyword-picker">
    <Chips label="Weapon ability" options={options} value={value} onChange={onChange} render={(option) => option} />
    <Chips label="Weapon ability with a value" options={VALUED_KEYWORDS} value={valued} render={(option) => option}
      onChange={(base) => onChange(amount ? `${base} ${amount}` : base)} />
    {valued && <Chips label={`${valued} value`} options={KEYWORD_VALUES} value={amount} onChange={(next) => onChange(`${valued} ${next}`)} />}
    <input aria-label="Other weapon ability" placeholder="Other, for example Anti-Infantry 4+" value={options.includes(value) || valued ? "" : value}
      onChange={(event) => onChange(event.target.value)} />
  </div>;
}

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
    const chosen = families.find((item) => item.id === id);
    const starter = structuredClone(chosen?.starter ?? {});
    // Prefill what the source states outright: the bracketed weapon ability, melee or ranged, and an "N+" threshold.
    for (const [name, property] of Object.entries(chosen?.parameterSchema.properties ?? {})) {
      const limited = name === "weapon_type" ? /\b(melee|ranged) weapons?\b/iu.exec(exactText)?.[1]?.toLowerCase() : undefined;
      if (limited) { starter[name] = limited; continue; }
      if (starter[name] !== "" && starter[name] !== null && starter[name] !== undefined) continue;
      if (freeText(property)) starter[name] = keywordFromSource(exactText, choices(property)) ?? "";
      else if (numeric(property) && name === "threshold") {
        const threshold = /\b([2-6])\+/u.exec(exactText)?.[1];
        if (threshold) starter[name] = Number(threshold);
      }
    }
    setParameters(starter);
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
        return <fieldset key={name} className="wb-field-wide"><legend>{label}</legend>
          <KeywordPicker options={options} value={typeof value === "string" ? value : ""} onChange={(next) => set(name, next)} /></fieldset>;
      }
      if (options.length && options.length <= 12) {
        return <fieldset key={name}><legend>{label}</legend>
          <Chips label={label} options={sourceable(property) ? [...options, "__source"] : options} value={isSource ? "__source" : value}
            render={(option) => option === "__source" ? "exact words…" : option.replaceAll("-", " ")}
            onChange={(next) => set(name, next === "__source" ? { source: exactText } : next)} />
          {isSource && <input value={String((value as { source: unknown }).source)} onChange={(event) => set(name, { source: event.target.value })} aria-label={`${label} source words`} />}
        </fieldset>;
      }
      if (numeric(property) && property.minimum !== undefined && property.maximum !== undefined && property.maximum - property.minimum <= 10) {
        const range = Array.from({ length: property.maximum - property.minimum + 1 }, (_, index) => String(property.minimum! + index));
        return <fieldset key={name}><legend>{label}</legend>
          <Chips label={label} options={range} value={typeof value === "number" ? String(value) : ""} onChange={(next) => set(name, Number(next))}
            render={(option) => name === "threshold" ? `${option}+` : option} /></fieldset>;
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
