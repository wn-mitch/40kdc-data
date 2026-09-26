import { useEffect, useState } from "react";

import { choices, freeText, numeric, prefillFromSource } from "./leaf-prefill";
import { api } from "./workbench-api";

/** One reviewed family as the bridge lists it (deprecated versions are never listed). */
export type Family = {
  id: string; version: number; role: string; label: string; description: string;
  starter: Record<string, unknown>;
  parameterSchema: { properties?: Record<string, Property> };
};
export type Property = {
  enum?: string[]; anyOf?: Property[]; type?: string; pattern?: string; minimum?: number; maximum?: number;
  items?: { enum?: string[]; type?: string; pattern?: string };
  "x-only-when"?: Record<string, readonly string[]>;
};

/** A property applies only when the other parameters it depends on have one of the listed values. */
const applies = (property: Property, parameters: Record<string, unknown>) =>
  !property["x-only-when"] || Object.entries(property["x-only-when"]).every(([key, values]) => values.includes(String(parameters[key])));

const ROLE_LABELS: Record<string, string> = {
  CONDITION: "Condition: when it applies", EVENT: "Event: when it fires", EFFECT: "Effect: what changes", DURATION: "Duration: how long",
  COMBINATOR: "Combinator: how effects join",
  RESTRICTION: "Restriction: who can use it, when, and how often",
};

const sourceable = (property: Property) => property.anyOf?.some((item) => item.type === "object") ?? false;

/** Weapon abilities that carry a value, and the values GW prints for them. */
const VALUED_KEYWORDS = ["Sustained Hits", "Rapid Fire", "Melta"] as const;
const KEYWORD_VALUES = ["1", "2", "3", "D3", "D6"] as const;

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

/** Unit keywords typed as a comma-separated list; the text is kept as typed until it parses to new keywords. */
function KeywordList({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  const parse = (raw: string) => raw.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  useEffect(() => {
    if (parse(text).join("\u0000") !== value.join("\u0000")) setText(value.join(", "));
  }, [value.join("\u0000")]);
  return <input value={text} placeholder="For example CHARACTER, or MONSTER, VEHICLE"
    onChange={(event) => { setText(event.target.value); onChange(parse(event.target.value)); }} />;
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
    // Nothing is chosen by default; only what the source wording states outright is filled in.
    const prefill = prefillFromSource(families.find((item) => item.id === id), exactText);
    setParameters(prefill);
  };
  // Changing a parameter drops the ones that stop applying (a phase once the event is no longer a phase boundary).
  const set = (name: string, value: unknown) => setParameters((current) => {
    const next: Record<string, unknown> = { ...current, [name]: value };
    for (const [key, property] of Object.entries(properties)) if (!applies(property, next)) delete next[key];
    return next;
  });
  const visible = Object.entries(properties).filter(([, property]) => applies(property, parameters));
  const complete = family && visible.every(([name]) => {
    const value = parameters[name];
    return value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)
      && !(typeof value === "object" && "source" in value && !String((value as { source: unknown }).source).trim());
  });
  const roles = role ? [role] : Object.keys(ROLE_LABELS);
  const [preview, setPreview] = useState<{ text: string | null; problem: string | null } | null>(null);
  const previewKey = complete ? JSON.stringify([familyId, parameters]) : null;
  useEffect(() => {
    setPreview(null);
    if (!previewKey) return;
    const controller = new AbortController();
    api<{ text: string | null; problem: string | null }>("/leaves/preview", { family_id: familyId, parameters }, controller.signal)
      .then(setPreview).catch(() => undefined);
    return () => controller.abort();
  }, [previewKey]);
  return <form className="wb-leaf-form" onSubmit={(event) => { event.preventDefault(); if (complete) onSubmit(familyId, parameters); }}>
    <label>Meaning<select value={familyId} onChange={(event) => choose(event.target.value)}>
      <option value="">Choose what this wording means</option>
      {roles.map((item) => <optgroup key={item} label={ROLE_LABELS[item] ?? item}>
        {families.filter((candidate) => candidate.role === item).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
      </optgroup>)}
    </select></label>
    {family && <p className="wb-help">{family.description}</p>}
    <div className="wb-editor-grid">{visible.map(([name, property]) => {
      const value = parameters[name];
      const options = choices(property);
      const label = name.replaceAll("_", " ");
      const isSource = value !== null && typeof value === "object" && "source" in value;
      if (property.type === "boolean") {
        return <fieldset key={name}><legend>{label}</legend>
          <Chips label={label} options={["no", "yes"]} value={value === true ? "yes" : value === false ? "no" : null} onChange={(next) => set(name, next === "yes")} /></fieldset>;
      }
      if (property.type === "array" && property.items?.enum) {
        const selected = Array.isArray(value) ? value.map(String) : [];
        return <fieldset key={name} className="wb-field-wide"><legend>{label} (any of)</legend>
          <div className="wb-chips" role="group" aria-label={label}>{property.items.enum.map((option) => {
            const on = selected.includes(option);
            return <button key={option} type="button" role="checkbox" aria-checked={on} className={on ? "wb-chip wb-chip-on" : "wb-chip"}
              onClick={() => set(name, on ? selected.filter((item) => item !== option) : [...selected, option])}>{option.replaceAll("-", " ")}</button>;
          })}</div></fieldset>;
      }
      if (property.type === "array") {
        return <label key={name} className="wb-field-wide">{label} (any of, comma-separated)
          <KeywordList value={Array.isArray(value) ? value.map(String) : []} onChange={(next) => set(name, next)} /></label>;
      }
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
      if (numeric(property) && property.minimum !== undefined && property.maximum !== undefined && property.maximum - property.minimum <= 12) {
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
    {preview && <p className={preview.text ? "wb-leaf-preview" : "error"}>{preview.text ? <>Reads as: <strong>{preview.text}</strong></> : preview.problem}</p>}
    <div className="wb-actions">
      <button className="primary" type="submit" disabled={busy || !complete || Boolean(preview?.problem)}>{submitLabel}</button>
      <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
