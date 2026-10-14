/** Mechanical round-6 rewrites for effect nodes.
 *
 * This pass is deliberately conservative.  It only decodes closed, mechanical legacy
 * spellings; an unrecognised value is reported and left in the returned clone.  The
 * caller owns recursive traversal, so nested effect/condition nodes are not walked here.
 */
import type { CutoverContext, Node } from "./vocab-cutover-types.js";
import { negate } from "../round5c/compile-conditions.js";
import weaponKeywordCatalog from "../../../data/core/weapon-keywords.json";
type CatalogKeyword = { id: string; name: string; required_parameters?: readonly string[] };
const CATALOG: Record<string, CatalogKeyword> = Object.fromEntries(
  (weaponKeywordCatalog as readonly CatalogKeyword[]).map((entry) => [entry.id, entry]),
);
// This identity is staged by the round-6 catalog cutover even when the checked-in catalog
// projection has not yet landed it.  It has no required parameters.
CATALOG["supa-hazardous"] = { id: "supa-hazardous", name: "Supa-Hazardous", required_parameters: [] };

const WEAPON_IDS: Record<string, true> = Object.fromEntries(Object.keys(CATALOG).map((id) => [id, true]));
const VALUE_IDS: Record<string, true> = Object.fromEntries(
  Object.values(CATALOG)
    .filter((entry) => entry.required_parameters?.length === 1 && entry.required_parameters[0] === "value")
    .map((entry) => [entry.id, true]),
);

const object = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);
const differs = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);

function report(ctx: CutoverContext, reason: string, node: unknown): void {
  ctx.report(reason, node, ctx.pointer);
}

function kebab(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[_\s]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

type KeywordRef = { keyword_id: string; parameters?: Node };
function antiParameters(parameters: Node): Node {
  if (typeof parameters.target_keyword !== "string") return parameters;
  const keywords = parameters.target_keyword.split("/").map((keyword) => keyword.trim().toUpperCase());
  if (keywords.length === 1 && !keywords[0]!.startsWith("NON-")) return parameters;
  const { target_keyword: _target, ...out } = parameters;
  const positive = keywords.filter((keyword) => !keyword.startsWith("NON-"));
  const excluded = keywords.filter((keyword) => keyword.startsWith("NON-")).map((keyword) => keyword.slice(4));
  if (positive.length) out.required_target_keywords_any = positive;
  if (excluded.length) out.excluded_target_keywords = excluded;
  return out;
}

/** Parse only catalog-backed, mechanically equivalent printed weapon keywords. */
function weaponKeyword(value: unknown, ctx: CutoverContext, grant = false): KeywordRef | null {
  if (object(value) && typeof value.keyword_id === "string") {
    const entry = CATALOG[value.keyword_id];
    if (!entry) {
      report(ctx, `unknown weapon keyword ${value.keyword_id}`, value);
      return null;
    }
    const required = entry.required_parameters ?? [];
    const parameters = object(value.parameters) ? value.parameters : {};
    const missing = grant ? required.filter((key) => parameters[key] === undefined && !(entry.id === "anti" && key === "target_keyword" && (parameters.required_target_keywords_any !== undefined || parameters.excluded_target_keywords !== undefined))) : [];
    if (missing.length > 0) {
      report(ctx, `weapon keyword ${value.keyword_id} is missing required parameters: ${missing.join(", ")}`, value);
      return null;
    }
    return clone(value) as KeywordRef;
  }
  if (typeof value !== "string" || value.trim() === "") {
    report(ctx, "weapon keyword is not a non-empty catalog string", value);
    return null;
  }
  const raw = value.trim();
  const bareAnti = /^anti[-\s]+([A-Za-z][A-Za-z\s/'-]*(?:\/[A-Za-z][A-Za-z\s/'-]*)*)$/i.exec(raw);
  if (bareAnti && !grant) return { keyword_id: "anti", parameters: antiParameters({ target_keyword: bareAnti[1]!.trim().toUpperCase() }) };
  const anti = /^anti[-\s]+([A-Za-z][A-Za-z\s/'-]*(?:\/[A-Za-z][A-Za-z\s/'-]*)*)\s+([2-6])(?:\+|PLUS)?$/i.exec(raw);
  if (anti) return { keyword_id: "anti", parameters: antiParameters({ target_keyword: anti[1]!.trim().toUpperCase(), threshold: Number(anti[2]) }) };

  const suffixMatch = /^(.+?)(?:\s+|-)?(D[36](?:\+\d+)?|\d+)$/i.exec(raw);
  const baseText = suffixMatch ? suffixMatch[1]!.trim() : raw;
  const base = kebab(baseText);
  const entry = CATALOG[base] ?? Object.values(CATALOG).find((candidate) => kebab(candidate.name).replaceAll("-", "") === base.replaceAll("-", ""));
  if (!entry) {
    report(ctx, `unknown weapon keyword ${raw}`, value);
    return null;
  }
  const suffix = suffixMatch?.[2];
  if (suffix !== undefined) {
    const parameter: number | string = /^D/i.test(suffix) ? suffix.toUpperCase() : Number(suffix);
    if (!VALUE_IDS[entry.id] && entry.id !== "blast") {
      report(ctx, `weapon keyword ${raw} has an unsupported rating`, value);
      return null;
    }
    return { keyword_id: entry.id, parameters: { value: parameter } };
  }
  if (grant && (entry.required_parameters?.length ?? 0) > 0) {
    report(ctx, `weapon keyword ${raw} is missing required parameters`, value);
    return null;
  }
  return { keyword_id: entry.id };
}

function keywordSelection(value: unknown, ctx: CutoverContext): unknown | null {
  if (Array.isArray(value)) {
    const refs: KeywordRef[] = [];
    let valid = true;
    for (const item of value) {
      const ref = weaponKeyword(item, ctx);
      if (ref) refs.push(ref); else valid = false;
    }
    return valid ? (refs.length === 1 ? refs[0] : refs) : null;
  }
  return weaponKeyword(value, ctx);
}

function range(value: unknown, ctx: CutoverContext): unknown {
  if (typeof value === "number") return { inches: value };
  if (typeof value === "string" || object(value)) return clone(value);
  report(ctx, "distance is not a numeric or named range", value);
  return value;
}

function normalizeDistances(value: Node, ctx: CutoverContext, scaling = false): void {
  const out = value;
  const aliases = scaling ? ["within_inches"] : ["range_inches", "radius_inches", "aura_range_inches"];
  for (const old of aliases) {
    if (!(old in out)) continue;
    const next = scaling ? "within" : "range";
    if (next in out) {
      if (differs(out[next], out[old])) report(ctx, `${old} conflicts with ${next}`, value);
      continue;
    }
    out[next] = range(out[old], ctx);
    delete out[old];
  }
  if ("range" in out && (typeof out.range === "number")) out.range = range(out.range, ctx);
  for (const key of ["min_enemy_distance", "within_edge"]) {
    if (key in out && (typeof out[key] === "number")) out[key] = range(out[key], ctx);
  }
  if (object(out.min_distance_from) && "range" in out.min_distance_from && typeof out.min_distance_from.range === "number")
    out.min_distance_from.range = range(out.min_distance_from.range, ctx);
  if ("marker_range" in out && (typeof out.marker_range === "number")) out.marker_range = { range: range(out.marker_range, ctx) };
}

function target(value: unknown, ctx: CutoverContext): unknown {
  if (object(value)) return oldFilter(value, ctx) ?? clone(value);
  if (typeof value !== "string") return clone(value);
  const refs: Record<string, string> = {
    unit: "this-unit", self: "this-model", bearer: "this-model", "attached-unit": "this-unit",
    "selected-models-unit": "selected-unit", attacker: "attacker", defender: "defender",
    "destroyed-model": "event-object", "triggering-unit": "event-subject",
  };
  if (refs[value]) return refs[value];
  const canonical = ["this-unit", "this-model", "model-in-this-unit", "event-subject", "event-object", "selected-unit", "recipient", "attacker", "defender", "ability-unit", "bearer-transport", "stratagem-target"];
  if (canonical.includes(value)) return value;
  report(ctx, `unknown effect target ${value}`, value);
  return value;
}

function oldFilter(value: unknown, ctx: CutoverContext): Node | null {
  if (!object(value)) {
    report(ctx, "filter is not an object", value);
    return null;
  }
  const out: Node = { ...clone(value) };
  if (Array.isArray(out.keywords)) { out.all_of = clone(out.keywords); delete out.keywords; }
  if (Array.isArray(out.required_keywords)) {
    const all = Array.isArray(out.all_of) ? [...out.all_of] : [];
    out.all_of = [...all, ...clone(out.required_keywords)];
    delete out.required_keywords;
  }
  if (typeof out.faction === "string") {
    const all = Array.isArray(out.all_of) ? [...out.all_of] : [];
    all.push(out.faction.toUpperCase());
    out.all_of = [...new Set(all)];
    delete out.faction;
  } else if (out.faction !== undefined) {
    report(ctx, "filter faction must be a string", out.faction);
  }
  if (Array.isArray(out.excluded_keywords)) {
    const none = Array.isArray(out.none_of) ? [...out.none_of] : [];
    out.none_of = [...none, ...clone(out.excluded_keywords)];
    delete out.excluded_keywords;
  }
  if (typeof out.excludes_keyword === "string") {
    const none = Array.isArray(out.none_of) ? [...out.none_of] : [];
    out.none_of = [...none, out.excludes_keyword];
    delete out.excludes_keyword;
  } else if (out.excludes_keyword !== undefined) {
    report(ctx, "filter excludes_keyword must be a string", out.excludes_keyword);
  }
  if (out.target_kind === "model" || out.target_kind === "unit") { out.level = out.target_kind; delete out.target_kind; }
  if (typeof out.within_inches === "number") { out.within = { range: { inches: out.within_inches } }; delete out.within_inches; }
  if (typeof out.range_inches === "number") { out.within = { range: { inches: out.range_inches } }; delete out.range_inches; }
  if (out.reference === "bearer-unit") { out.within = { ...(object(out.within) ? out.within : {}), of: "this-unit" }; delete out.reference; }
  if (out.reference === "bearer") { out.within = { ...(object(out.within) ? out.within : {}), of: "this-model" }; delete out.reference; }
  if (out.visibility_required === true) { out.visible = { to: "this-unit" }; delete out.visibility_required; }
  if (out.visible === true) out.visible = { to: "this-unit" };
  if ("engagement_relation" in out) {
    if (out.engagement_relation === "engaged-with-bearer") {
      out.engaged_with = out.reference === "bearer-unit" ? "this-unit" : "this-model";
      delete out.engagement_relation;
    } else report(ctx, `unknown selector engagement relation ${String(out.engagement_relation)}`, value);
  }
  return out;
}

function modelTarget(raw: unknown, modifier: Node, ctx: CutoverContext): unknown {
  const out = target(raw, ctx);
  const bodyguard = modifier.bodyguard_only === true || modifier.exclude_leader === true;
  const hasKeyword = typeof modifier.model_keyword === "string" || typeof modifier.exclude_model_keyword === "string";
  if (!bodyguard && !hasKeyword) return out;
  const modelFilter: Node =
    object(out) && ("level" in out || "member_of" in out || "attachment_role" in out)
      ? { ...clone(out) }
      : { member_of: out };
  if (modelFilter.level !== undefined && modelFilter.level !== "model") report(ctx, "model restriction conflicts with a non-model target", raw);
  modelFilter.level = "model";
  if (modelFilter.attachment_role === undefined && bodyguard) modelFilter.attachment_role = "bodyguard";
  if (modelFilter.member_of === undefined) {
    const unitRefs = ["this-unit", "model-in-this-unit", "event-subject", "event-object", "selected-unit", "recipient", "attacker", "defender", "bearer-transport", "ability-unit"];
    if (typeof raw === "string" && unitRefs.includes(raw)) modelFilter.member_of = out;
    else report(ctx, "model restriction needs an explicit unit member_of target", raw);
  }
  if (typeof modifier.model_keyword === "string") {
    const all = Array.isArray(modelFilter.all_of) ? [...modelFilter.all_of] : [];
    all.push(modifier.model_keyword);
    modelFilter.all_of = [...new Set(all)];
  } else if (modifier.model_keyword !== undefined) report(ctx, "model_keyword must be a string", modifier.model_keyword);
  if (typeof modifier.exclude_model_keyword === "string") {
    const none = Array.isArray(modelFilter.none_of) ? [...modelFilter.none_of] : [];
    none.push(modifier.exclude_model_keyword);
    modelFilter.none_of = [...new Set(none)];
  } else if (modifier.exclude_model_keyword !== undefined) report(ctx, "exclude_model_keyword must be a string", modifier.exclude_model_keyword);
  return modelFilter;
}

function weaponScope(modifier: Node, ctx: CutoverContext): void {
  const scope: Node = object(modifier.weapons) ? { ...clone(modifier.weapons) } : {};
  let used = object(modifier.weapons);
  let typeMigrated = false;
  let nameMigrated = false;
  let keywordMigrated = false;
  let excludedKeywordMigrated = false;
  let refMigrated = false;
  let excludedNameMigrated = false;
  const set = (key: string, value: unknown): void => {
    if (scope[key] !== undefined && differs(scope[key], value)) report(ctx, `weapon scope ${key} has conflicting values`, modifier);
    else scope[key] = value;
    used = true;
  };
  if (modifier.weapon_type !== undefined || modifier.attack_type !== undefined) {
    const raw = modifier.weapon_type ?? modifier.attack_type;
    if (raw === "melee" || raw === "ranged") { set("type", raw); typeMigrated = true; }
    else report(ctx, `unknown weapon type ${String(raw)}`, modifier);
  }
  if (modifier.weapon_name !== undefined || modifier.weapon !== undefined) {
    const raw = modifier.weapon_name ?? modifier.weapon;
    if (typeof raw === "string" && raw.length > 0) { set("name", raw); nameMigrated = true; }
    else report(ctx, "weapon name is not a non-empty string", raw);
  }
  if ("weapon_keyword" in modifier) {
    const parsed = keywordSelection(modifier.weapon_keyword, ctx);
    if (parsed !== null) { set("keyword", parsed); keywordMigrated = true; }
  }
  if ("exclude_weapon_keyword" in modifier) {
    const parsed = keywordSelection(modifier.exclude_weapon_keyword, ctx);
    if (parsed !== null) { set("exclude_keyword", parsed); excludedKeywordMigrated = true; }
  }
  if (modifier.weapon_ref !== undefined) {
    if (object(modifier.weapon_ref)) { set("ref", clone(modifier.weapon_ref)); refMigrated = true; }
    else report(ctx, "weapon_ref must be an object", modifier.weapon_ref);
  }
  if (modifier.exclude_weapon_name !== undefined) {
    if (typeof modifier.exclude_weapon_name === "string" && modifier.exclude_weapon_name.length > 0) {
      set("exclude_name", modifier.exclude_weapon_name);
      excludedNameMigrated = true;
    } else report(ctx, "exclude_weapon_name is not a non-empty string", modifier.exclude_weapon_name);
  }
  if (typeMigrated) {
    delete modifier.weapon_type;
    delete modifier.attack_type;
  }
  if (nameMigrated) {
    delete modifier.weapon_name;
    delete modifier.weapon;
  }
  if (keywordMigrated) delete modifier.weapon_keyword;
  if (excludedKeywordMigrated) delete modifier.exclude_weapon_keyword;
  if (refMigrated) delete modifier.weapon_ref;
  if (excludedNameMigrated) delete modifier.exclude_weapon_name;
  if (used && Object.keys(scope).length > 0) modifier.weapons = scope;
}

function convertAbilities(modifier: Node, ctx: CutoverContext): void {
  if (!("abilities" in modifier)) return;
  if (!Array.isArray(modifier.abilities)) { report(ctx, "weapon grant abilities must be an array", modifier.abilities); return; }
  const refs: KeywordRef[] = [];
  let valid = true;
  for (const item of modifier.abilities) {
    const ref = weaponKeyword(item, ctx, true);
    if (ref) refs.push(ref); else valid = false;
  }
  if (valid) { modifier.keywords = refs; delete modifier.abilities; }
}
function convertRemovals(modifier: Node, ctx: CutoverContext): void {
  if (!Array.isArray(modifier.removes)) return;
  const refs: KeywordRef[] = [];
  let valid = true;
  for (const item of modifier.removes) {
    const ref = weaponKeyword(item, ctx);
    if (ref) refs.push(ref); else valid = false;
  }
  if (valid) modifier.removes = refs;
}

function countBounds(selector: Node, ctx: CutoverContext): void {
  if (object(selector.count)) return;
  if (typeof selector.count === "number") selector.count = { min: selector.count, max: selector.count };
  else if (selector.count === "all") selector.count = { min: 0 };
  else if (selector.count !== undefined) report(ctx, "selector count is not a supported quantity", selector.count);
  if (typeof selector.max_count === "number") {
    if (selector.count !== undefined) report(ctx, "selector has both count and max_count", selector);
    else selector.count = { min: 0, max: selector.max_count };
    delete selector.max_count;
  }
}

function regionRef(value: unknown, ctx: CutoverContext): unknown {
  if (object(value)) return clone(value);
  if (typeof value !== "string") { report(ctx, "named region is not a string or region reference", value); return value; }
  const territory: Record<string, string> = {
    "own-deployment-zone": "your-deployment-zone", "your-deployment-zone": "your-deployment-zone",
    "opponent-deployment-zone": "enemy-deployment-zone", "enemy-deployment-zone": "enemy-deployment-zone",
    "no-mans-land": "no-mans-land", "your-territory": "your-territory", "enemy-territory": "enemy-territory",
  };
  if (territory[value]) return { territory: territory[value] };
  report(ctx, `unknown named-region zone ${value}`, value);
  return value;
}

function durationFromExpiry(expiry: unknown, ctx: CutoverContext): string | undefined {
  if (!object(expiry) || typeof expiry.event !== "string") { report(ctx, "named-region expiry is malformed", expiry); return undefined; }
  const values: Record<string, string> = { never: "permanent", "phase-end": "phase", "turn-end": "turn", "battle-end": "battle" };
  if (values[expiry.event]) return values[expiry.event];
  report(ctx, `unknown named-region expiry ${expiry.event}`, expiry);
  return undefined;
}

function controlsCondition(gate: unknown, zone: unknown, ctx: CutoverContext): Node | null {
  if (!object(gate)) { report(ctx, "named-region control gate is malformed", gate); return null; }
  const p: Node = {};
  if (gate.controlled_by === "owner-army") p.by = "friendly";
  else if (gate.controlled_by !== undefined) { report(ctx, `unknown named-region controller ${String(gate.controlled_by)}`, gate); }
  const threshold = object(gate.threshold) ? gate.threshold : undefined;
  if (threshold && typeof threshold.comparison === "string" && typeof threshold.fraction === "number") {
    const comparisons: Record<string, string> = { "at-least": "gte", "at-most": "lte", gte: "gte", lte: "lte", gt: "gt", lt: "lt", eq: "eq" };
    const comparison = comparisons[threshold.comparison];
    if (!comparison) report(ctx, `unknown named-region comparison ${threshold.comparison}`, threshold);
    else p.proportion = { comparison, fraction: threshold.fraction };
  } else { report(ctx, "named-region control gate threshold is malformed", gate); }
  const r = regionRef(zone, ctx);
  if (object(r) && object(r.territory)) p.objective = { territory: r.territory };
  return { type: "controls", ...(Object.keys(p).length ? { parameters: p } : {}) };
}

function producer(value: unknown, ctx: CutoverContext): Node | null {
  if (!object(value)) { report(ctx, "named-region producer is malformed", value); return null; }
  const out: Node = { ...clone(value) };
  if (typeof out.region_ref === "string") {
    if (ctx.faction) out.region_ref = { region_id: out.region_ref, owner_faction: ctx.faction };
    else report(ctx, "named-region producer string region_ref needs owner faction", out.region_ref);
  }
  if (Array.isArray(out.baseline)) {
    const baseline: unknown[] = [];
    for (const item of out.baseline) {
      if (!object(item) || item.region !== undefined) { baseline.push(clone(item)); continue; }
      const zone = item.zone;
      const duration = durationFromExpiry(item.expiry, ctx);
      if (zone === undefined || duration === undefined) { baseline.push(clone(item)); continue; }
      baseline.push({ region: regionRef(zone, ctx), duration });
    }
    out.baseline = baseline;
  }
  if (Array.isArray(out.phase_extensions)) {
    const extensions: unknown[] = [];
    for (const item of out.phase_extensions) {
      if (!object(item) || item.region !== undefined) { extensions.push(clone(item)); continue; }
      const activation = object(item.activation) ? item.activation : undefined;
      const expiry = item.expiry;
      const condition = controlsCondition(item.control_gate, item.zone, ctx);
      if (!activation || condition === null || !object(expiry)) { extensions.push(clone(item)); continue; }
      const event = activation.event === "phase-start" ? "phase-started" : activation.event;
      if (event !== "phase-started") { report(ctx, `unknown named-region activation ${String(activation.event)}`, activation); extensions.push(clone(item)); continue; }
      const evaluation = activation.evaluation ?? "snapshot-once";
      if (evaluation !== "snapshot-once") { report(ctx, `unknown named-region evaluation ${String(evaluation)}`, activation); extensions.push(clone(item)); continue; }
      const duration = durationFromExpiry(expiry, ctx);
      if (!duration) { extensions.push(clone(item)); continue; }
      extensions.push({ region: regionRef(item.zone, ctx), condition, trigger: { event }, duration, evaluation });
    }
    out.phase_extensions = extensions;
  }
  if (Array.isArray(out.additive_extensions)) {
    out.additive_extensions = out.additive_extensions.map((raw) => {
      if (!object(raw) || raw.filter !== undefined) return clone(raw);
      const gate = object(raw.source_gate) ? raw.source_gate : undefined;
      const pred = gate && object(gate.unit_predicate) ? gate.unit_predicate : undefined;
      if (!gate || !pred) { report(ctx, "named-region additive extension lacks a unit source predicate", raw); return clone(raw); }
      const f = oldFilter({ owner: gate.owner === "owner-army" ? "friendly" : gate.owner, ...pred }, ctx);
      if (!f || typeof raw.radius_inches !== "number") { report(ctx, "named-region additive extension is malformed", raw); return clone(raw); }
      return { kind: "unit-proximity", filter: f, range: { inches: raw.radius_inches } };
    });
  }
  return out;
}

function branch(value: unknown, ctx: CutoverContext): Node | null {
  if (!object(value) || !object(value.effect)) { report(ctx, "named-region branch is malformed", value); return null; }
  const part: Node = { type: "ability-part", effect: clone(value.effect) };
  if (typeof value.optional === "boolean") part.optional = value.optional;
  if (typeof value.duration === "string") part.duration = value.duration === "attack-resolution" ? "resolution" : value.duration;
  return part;
}

function consumer(value: unknown, ctx: CutoverContext): Node | null {
  if (!object(value)) { report(ctx, "named-region consumer is malformed", value); return null; }
  const out: Node = { ...clone(value) };
  if (out.beneficiary_filter === undefined && out.beneficiary_gate !== undefined) {
    const gate = out.beneficiary_gate;
    if (object(gate)) {
      const f: Node = {};
      let valid = true;
      if (gate.owner === "owner-army") f.owner = "friendly";
      else if (gate.owner === "friendly" || gate.owner === "enemy") f.owner = gate.owner;
      else if (gate.owner !== undefined) { report(ctx, `unknown named-region beneficiary owner ${String(gate.owner)}`, gate); valid = false; }
      if (gate.faction !== undefined) {
        if (typeof gate.faction === "string") f.all_of = [gate.faction.toUpperCase()];
        else { report(ctx, "named-region beneficiary faction is malformed", gate); valid = false; }
      }
      if (gate.operator === "and" && Array.isArray(gate.keywords)) f.all_of = [...(Array.isArray(f.all_of) ? f.all_of : []), ...clone(gate.keywords)];
      else if (gate.operator === "or" && Array.isArray(gate.keywords)) f.any_of = clone(gate.keywords);
      else if (gate.operator !== undefined) { report(ctx, `unknown named-region beneficiary operator ${String(gate.operator)}`, gate); valid = false; }
      if (valid) {
        out.beneficiary_filter = f;
        delete out.beneficiary_gate;
      }
    } else report(ctx, "named-region beneficiary gate is malformed", gate);
  }
  if (out.region_ref !== undefined) {
    if (out.state_ref === undefined) out.state_ref = clone(out.region_ref);
    delete out.region_ref;
  }
  for (const key of ["default_branch", "qualified_branch"] as const) {
    const current = out[key];
    if (object(current) && object(current.effect) && current.effect.type === "ability-part") continue;
    if (current !== undefined) {
      const part = branch(current, ctx);
      if (part) out[key] = { effect: part };
    }
  }
  return out;
}

function namedRegion(node: Node, ctx: CutoverContext): Node {
  const out: Node = { ...clone(node) };
  const m = object(out.modifier) ? { ...clone(out.modifier) } : null;
  if (!m) { report(ctx, "named-region-state has no modifier", node); return out; }
  if (typeof m.region_ref === "string") {
    if (ctx.faction) m.region_ref = { region_id: m.region_ref, owner_faction: ctx.faction };
    else report(ctx, "named-region string region_ref needs owner faction", m.region_ref);
  } else if (m.region_ref !== undefined) m.region_ref = clone(m.region_ref);
  if (m.producer !== undefined) { const p = producer(m.producer, ctx); if (p) m.producer = p; }
  if (m.consumer !== undefined) { const c = consumer(m.consumer, ctx); if (c) m.consumer = c; }
  out.modifier = m;
  return out;
}

function leaderGrant(node: Node, ctx: CutoverContext): Node {
  const allowed = ["type", "source", "beneficiary", "duration", "grant", "leader_filter", "attached_unit_filter", "recipient_binding"];
  const extras = Object.keys(node).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    report(ctx, `leader-model-ability-grant fields ${extras.join(", ")} are not safely relocatable`, node);
    return { ...clone(node) };
  }
  const grant = object(node.grant) ? node.grant : null;
  if (grant) {
    const grantExtras = Object.keys(grant).filter((key) => !["recipient", "effect"].includes(key));
    if (grantExtras.length > 0) {
      report(ctx, `leader-model-ability-grant grant fields ${grantExtras.join(", ")} are not safely relocatable`, grant);
      return { ...clone(node) };
    }
  }
  if (!grant || !object(grant.effect)) { report(ctx, "leader-model-ability-grant lacks an inline effect", node); return { ...clone(node) };
  }
  if (node.beneficiary !== "leading-leader-model" || grant.recipient !== "beneficiary" || node.recipient_binding !== "beneficiary-only") {
    report(ctx, "leader-model-ability-grant beneficiary is not beneficiary-only", node);
    return { ...clone(node) };
  }
  const attached = node.attached_unit_filter === null || node.attached_unit_filter === undefined ? "this-unit" : oldFilter(node.attached_unit_filter, ctx);
  const leaders = node.leader_filter === null || node.leader_filter === undefined ? {} : oldFilter(node.leader_filter, ctx);
  if (attached === null || leaders === null) return { ...clone(node) };
  const inlineEffect = clone(grant.effect);
  if (object(inlineEffect)) {
    if (inlineEffect.target === "beneficiary") inlineEffect.target = "this-model";
    else if (inlineEffect.target === "beneficiary-unit") inlineEffect.target = "this-unit";
    else if (inlineEffect.target === undefined && ["ability-grant", "feel-no-pain"].includes(String(inlineEffect.type))) inlineEffect.target = "this-model";
  }
  const targetFilter: Node = { level: "model", member_of: attached, attachment_role: "leader", ...leaders };
  const definition: Node = { type: "ability-part", effect: inlineEffect };
  if (typeof node.duration === "string") definition.duration = node.duration;
  return { type: "ability-grant", target: targetFilter, modifier: { definition } };
}

function migrateAuraModifier(modifier: Node, ctx: CutoverContext): void {
  if (typeof modifier.range === "number") modifier.range = { inches: modifier.range };
  for (const key of ["eligible", "emitter_filter", "recipient_filter"] as const) {
    if (modifier[key] !== undefined) {
      const converted = oldFilter(modifier[key], ctx);
      if (converted) modifier[key] = converted;
    }
  }
}

function migrateResourceEligibility(node: Node, ctx: CutoverContext): void {
  if (!Array.isArray(node.actions)) return;
  for (const rawAction of node.actions) {
    if (!object(rawAction) || !object(rawAction.eligibility)) continue;
    const eligibility = { ...clone(rawAction.eligibility) };
    const filter = object(eligibility.filter) ? { ...clone(eligibility.filter) } : {};
    let hasFilter = object(eligibility.filter);
    if (Array.isArray(eligibility.requires_keyword)) {
      filter.all_of = [...(Array.isArray(filter.all_of) ? filter.all_of : []), ...clone(eligibility.requires_keyword)];
      delete eligibility.requires_keyword;
      hasFilter = true;
    } else if (eligibility.requires_keyword !== undefined) {
      report(ctx, "resource action requires_keyword must be an array", eligibility.requires_keyword);
    }
    if (Array.isArray(eligibility.excludes_keyword)) {
      filter.none_of = [...(Array.isArray(filter.none_of) ? filter.none_of : []), ...clone(eligibility.excludes_keyword)];
      delete eligibility.excludes_keyword;
      hasFilter = true;
    } else if (eligibility.excludes_keyword !== undefined) {
      report(ctx, "resource action excludes_keyword must be an array", eligibility.excludes_keyword);
    }
    if (hasFilter) eligibility.filter = filter;
    if (typeof eligibility.selector_count === "number") {
      eligibility.count = { min: eligibility.selector_count, max: eligibility.selector_count };
      delete eligibility.selector_count;
    } else if (eligibility.selector_count !== undefined) {
      report(ctx, "resource action selector_count must be a number", eligibility.selector_count);
    }
    rawAction.eligibility = eligibility;
  }
}

export function transformEffects(node: Node, ctx: CutoverContext): Node {
  const type = typeof node.type === "string" ? node.type : undefined;
  if (typeof node.keyword_id === "string" && !CATALOG[node.keyword_id]) {
    const normalized = weaponKeyword(node.keyword_id, ctx);
    if (normalized) {
      if (node.parameters !== undefined && differs(node.parameters, normalized.parameters)) ctx.report("legacy catalog label conflicts with explicit keyword parameters", node);
      else return { ...node, ...normalized };
    }
  }
  if (node.keyword_id === "anti" && object(node.parameters)) return { ...node, parameters: antiParameters(node.parameters) };
  if (type === "leader-model-ability-grant") return leaderGrant(node, ctx);
  if (type === "named-region-state") return namedRegion(node, ctx);
  const out: Node = { ...clone(node) };
  if (type === "resource-action-menu") migrateResourceEligibility(out, ctx);
  if (type !== undefined && type !== "aura" && "target" in out) out.target = target(out.target, ctx);
  const modifier = object(out.modifier) ? { ...clone(out.modifier) } : undefined;
  if (modifier) {
    normalizeDistances(modifier, ctx);
    weaponScope(modifier, ctx);
    if (type === "weapon-ability-grant") {
      convertAbilities(modifier, ctx);
      convertRemovals(modifier, ctx);
    }
    if (type === "aura") migrateAuraModifier(modifier, ctx);
    if (type === "designate") {
      if (object(modifier.subject)) {
        const subject = oldFilter(modifier.subject, ctx);
        if (subject) modifier.subject = subject;
      }
      if (modifier.clears_on === "never") modifier.clears_on = "permanent";
      else if (modifier.clears_on === "turn-rollover") modifier.clears_on = "turn";
    }
    if (type === "marker" && typeof modifier.distance === "number") modifier.distance = { inches: modifier.distance };
    if (type === "mortal-wounds" && object(modifier.roll)) {
      if (modifier.roll.per_model === "target" && out.target !== undefined) modifier.roll.per_model = clone(out.target);
      else if (modifier.roll.per_model === "this" && (
        ctx.faction === "orks" && ctx.record === "krushin-impetus-orks" ||
        ctx.faction === "adeptus-mechanicus" && ctx.record === "precision-onslaught-eradication-cohort-adeptus-mechanicus"
      )) {
        // Their trusted dice-roll leaves bind this count to the ability's own unit.
        modifier.roll.per_model = "this-unit";
      } else if (modifier.roll.per_model === "this" || modifier.roll.per_model === "target") {
        report(ctx, "per-model roll requires an explicit source-backed unit binding", modifier.roll);
      }
    }
    if (type === "targeting" && modifier.target !== undefined && modifier.target !== "every-eligible") modifier.target = target(modifier.target, ctx);
    if (type === "return-models" || type === "destroy-models") {
      out.target = modelTarget(out.target, modifier, ctx);
      for (const key of ["model_keyword", "exclude_model_keyword", "bodyguard_only", "exclude_leader"]) delete modifier[key];
    }
    out.modifier = modifier;
  }
  if (object(out.scaling)) {
    const scaling = { ...clone(out.scaling) };
    normalizeDistances(scaling, ctx, true);
    out.scaling = scaling;
  }
  if (type === "conditional" && "on_fail" in out) {
    const failure = out.on_fail;
    const extras = Object.keys(out).filter((key) => !["type", "condition", "effect", "on_fail"].includes(key));
    if (extras.length > 0) {
      report(ctx, `conditional fields ${extras.join(", ")} cannot be placed`, node);
    } else if (failure === null || failure === undefined) {
      delete out.on_fail;
    } else if (object(out.condition) && object(out.effect) && object(failure)) {
      delete out.on_fail;
      const success: Node = { type: "conditional", condition: clone(out.condition), effect: clone(out.effect) };
      const failed: Node = { type: "conditional", condition: negate(clone(out.condition)), effect: clone(failure) };
      return { type: "sequence", steps: [success, failed] };
    } else {
      report(ctx, "conditional on_fail requires object condition and effects", node);
    }
  }
  if (type === "choice") {
    for (const key of ["choice_prompt", "choice_label", "min_choices", "max_choices"]) if (key in node) out[key] = clone(node[key]);
  }
  if (type === "select-units" || type === "for-each-unit") {
    if (object(out.selector)) {
      const selector = { ...clone(out.selector) };
      countBounds(selector, ctx);
      out.selector = selector;
    }
  }
  return out;
}
