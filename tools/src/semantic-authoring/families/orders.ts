import { boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import { constTrue, isObject, kebabId, present, type Params } from "./containers-and-abilities-shared.js";
import type { FlatFamily } from "./types.js";

/** Changes to how a unit issues Orders, and Orders shared between two units (Astra Militarum). */

const ORDER_ISSUERS = ["this-unit", "this-model", "antecedent", "friendly-units"] as const;
const MODIFIER_KEYS = ["count", "range", "range_proxy", "off_battlefield", "adds_recipients"] as const;

/** A non-empty list of distinct keywords, as printed. */
function keywords(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new TypeError(`${label} lists one or more keywords as printed.`);
  }
  const list = (value as string[]).map((item) => item.trim());
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list;
}

function ordersModifier(input: Params): Params {
  const family = "orders-modifier";
  exactKeys(input, ["subject", ...present(input, ["issuer_keywords", "orders", "recipient_keywords", "recipient_excluded", ...MODIFIER_KEYS])], family);
  const subject = enumValue(input.subject, ORDER_ISSUERS, `${family}.subject`);
  const result: Params = { subject };
  if (subject === "friendly-units") result.issuer_keywords = keywords(input.issuer_keywords, `${family}.issuer_keywords`);
  else if ("issuer_keywords" in input) throw new TypeError(`${family}.issuer_keywords names the issuing units only when subject is friendly-units.`);
  if ("orders" in input) result.orders = keywords(input.orders, `${family}.orders`);
  if ("recipient_keywords" in input) result.recipient_keywords = keywords(input.recipient_keywords, `${family}.recipient_keywords`);
  if ("recipient_excluded" in input) {
    if (!("recipient_keywords" in input)) throw new TypeError(`${family}.recipient_excluded narrows recipient_keywords; name those first.`);
    result.recipient_excluded = keywords(input.recipient_excluded, `${family}.recipient_excluded`);
  }
  if ("count" in input) result.count = enumValue(input.count, ["any"], `${family}.count`);
  if ("range" in input) result.range = enumValue(input.range, ["unlimited"], `${family}.range`);
  if ("range_proxy" in input) {
    const proxy = input.range_proxy;
    if (!isObject(proxy)) throw new TypeError(`${family}.range_proxy is {marker, inches}.`);
    exactKeys(proxy, ["marker", "inches"], `${family}.range_proxy`);
    if ("range" in input) throw new TypeError(`${family} measures range either as if from a marker or not at all, not both.`);
    if (!("recipient_keywords" in input)) throw new TypeError(`${family}.range_proxy reaches the recipient units near the marker; name them in recipient_keywords.`);
    result.range_proxy = { marker: kebabId(proxy.marker, `${family}.range_proxy.marker`), inches: boundedInteger(proxy.inches, 1, 48, `${family}.range_proxy.inches`) };
  }
  if ("off_battlefield" in input) result.off_battlefield = constTrue(input.off_battlefield, `${family}.off_battlefield`);
  if ("adds_recipients" in input) {
    result.adds_recipients = constTrue(input.adds_recipients, `${family}.adds_recipients`);
    if (!("recipient_keywords" in input)) throw new TypeError(`${family}.adds_recipients makes the units in recipient_keywords eligible; name them.`);
  }
  if (!MODIFIER_KEYS.some((key) => key in result)) {
    throw new TypeError(`${family} changes at least one of ${MODIFIER_KEYS.join(", ")}.`);
  }
  return result;
}

function orderShare(input: Params): Params {
  exactKeys(input, ["units", ...present(input, ["mutual"])], "order-share");
  const result: Params = { units: enumValue(input.units, ["stratagem-targets"], "order-share.units") };
  if ("mutual" in input) result.mutual = constTrue(input.mutual, "order-share.mutual");
  return result;
}

export const ORDERS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "orders-modifier",
    version: 1,
    role: "EFFECT",
    label: "Change how Orders are issued",
    description: "Changes how a unit issues Orders without issuing one itself. subject is the issuer: this unit, this model, the unit an earlier leaf introduced (antecedent), or friendly-units with issuer_keywords (\"OFFICER units from your army\"). orders limits the change to these Orders, by printed name (\"when your model issues the Move! Move! Move! Order\"). recipient_keywords (and recipient_excluded) are the friendly units it reaches; adds_recipients makes them eligible to receive Orders they otherwise could not (\"it can issue Orders to ASTRA MILITARUM TRANSPORT units\"). count any: to any number of those units; range unlimited: regardless of range; range_proxy {marker, inches}: to recipients within inches of that marker as if the issuer were within inches of them; off_battlefield: even while the issuer is not on the battlefield.",
    starter: {subject: "this-unit"},
    parameterSchema: {type: "object", required: ["subject"], properties: {subject: {enum: [...ORDER_ISSUERS]}, issuer_keywords: {type: "array", minItems: 1, uniqueItems: true, items: {type: "string", minLength: 1}, "x-only-when": {subject: ["friendly-units"]}}, orders: {type: "array", minItems: 1, uniqueItems: true, items: {type: "string", minLength: 1}, "x-optional": true}, recipient_keywords: {type: "array", minItems: 1, uniqueItems: true, items: {type: "string", minLength: 1}, "x-optional": true}, recipient_excluded: {type: "array", minItems: 1, uniqueItems: true, items: {type: "string", minLength: 1}, "x-optional": true}, count: {enum: ["any"], "x-optional": true}, range: {enum: ["unlimited"], "x-optional": true}, range_proxy: {type: "object", required: ["marker", "inches"], properties: {marker: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, inches: {type: "integer", minimum: 1, maximum: 48}}, additionalProperties: false, "x-optional": true}, off_battlefield: {const: true, "x-optional": true}, adds_recipients: {const: true, "x-optional": true}}, additionalProperties: false},
    normalize: ordersModifier,
  },
  {
    id: "order-share",
    version: 1,
    role: "EFFECT",
    label: "Share Orders between units",
    description: "Orders affecting one unit also affect another: units stratagem-targets is the Stratagem's two targets, the first sharing its Orders with the second; mutual: and vice versa (\"Orders affecting one of your units affect the other, and vice versa\").",
    starter: {units: "stratagem-targets"},
    parameterSchema: {type: "object", required: ["units"], properties: {units: {enum: ["stratagem-targets"]}, mutual: {const: true, "x-optional": true}}, additionalProperties: false},
    normalize: orderShare,
  },
];
