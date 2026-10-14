/**
 * Plain text from the GW MFM dump's rich-text fields: `<b>` kept as `**bold**`, character
 * references decoded, line structure kept where it carries meaning, and rule-container
 * components assembled in display order (including the `altText` of image components, which is
 * where the dump states table-shaped rules such as per-round ranges and battle-size counts).
 */
import type { RuleContainerComponentRow } from "./loader.js";

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };

/** HTML character references as the characters they stand for ("&#x65;" → "e", "&amp;" → "&"). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** Inline markup to plain text on one line, `<b>` kept as `**bold**`; null/empty → undefined. */
export function plainLine(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = s
    .replace(/<b>(.*?)<\/b>/gis, "**$1**")
    .replace(/<[^>]+>/g, "")
    .replace(/&[#a-z0-9]+;/giu, (m) => decodeEntities(m))
    .replace(/\s+/g, " ")
    .trim();
  return t || undefined;
}

/**
 * Inline markup to plain text keeping line breaks: multi-section rules delimit their sub-rules by
 * line (the `■ **Name [cost]**` reward menus), and that structure carries meaning.
 */
export function plainBlock(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = s
    .replace(/<b>(.*?)<\/b>/gis, "**$1**")
    .replace(/<[^>]+>/g, "")
    .replace(/&[#a-z0-9]+;/giu, (m) => decodeEntities(m))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
  return t || undefined;
}

/** Bullet-point rows of a `bullets` component, as the dump's `bullet_point` table keeps them. */
export type BulletLookup = (componentId: string) => readonly { displayOrder: number; id: string; text?: string | null }[];

const byDisplayOrder = <T extends { displayOrder: number; id: string }>(a: T, b: T): number =>
  a.displayOrder - b.displayOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const bold = (t: string): string => `**${t.replace(/\*\*/g, "")}**`;

/** One component's prose blocks; flavour (lore, quotes) yields none. */
function componentBlocks(c: RuleContainerComponentRow, bullets?: BulletLookup): string[] {
  const en = c.localisations?.en;
  const out: string[] = [];
  const push = (t: string | undefined): void => {
    if (t) out.push(t);
  };
  switch (c.type) {
    case "text":
    case "textBold":
    case "boxedText":
      push(plainBlock(en?.textContent));
      break;
    case "bullets": {
      push(plainBlock(en?.textContent));
      for (const b of [...(bullets?.(c.id) ?? [])].sort(byDisplayOrder)) {
        const t = plainLine(b.text);
        if (t) out.push(`■ ${t}`);
      }
      break;
    }
    case "header": {
      const t = plainBlock(en?.textContent);
      if (t) out.push(bold(t));
      break;
    }
    case "accordion": {
      const title = plainBlock(en?.title);
      if (title) out.push(bold(title));
      push(plainBlock(en?.textContent));
      break;
    }
    case "triggerEffectAccordion": {
      const title = plainBlock(en?.title);
      if (title) out.push(bold(title));
      push(plainBlock(en?.trigger));
      push(plainBlock(en?.effect));
      break;
    }
    case "image":
      // The rendered table is an image; its altText is the only machine-readable statement of it.
      push(plainBlock(en?.altText));
      break;
    default:
      break; // loreAccordion / quote — flavour and worked examples
  }
  return out;
}

/** A rule's prose from its rule-container components, in display order; undefined if none carry text. */
export function assembleRuleText(components: readonly RuleContainerComponentRow[], bullets?: BulletLookup): string | undefined {
  const blocks = [...components].sort(byDisplayOrder).flatMap((c) => componentBlocks(c, bullets));
  return blocks.length ? blocks.join("\n") : undefined;
}

export interface RuleSection {
  /** The header component that opens the section. */
  header: RuleContainerComponentRow;
  /** The header's text: the sub-rule's printed name. */
  name: string;
  /** The section's prose, header excluded; undefined if the section carries none. */
  text: string | undefined;
}

/**
 * The header-delimited sections of a rule: each `header` component and the components after it
 * up to the next header. Army and detachment rules print named sub-rules this way (a rule that
 * gives units one of two abilities prints each ability under its own header).
 */
export function ruleSections(components: readonly RuleContainerComponentRow[], bullets?: BulletLookup): RuleSection[] {
  const sections: RuleSection[] = [];
  let open: { header: RuleContainerComponentRow; name: string; body: RuleContainerComponentRow[] } | null = null;
  const close = (): void => {
    if (!open) return;
    const blocks = open.body.flatMap((c) => componentBlocks(c, bullets));
    sections.push({ header: open.header, name: open.name, text: blocks.length ? blocks.join("\n") : undefined });
    open = null;
  };
  for (const c of [...components].sort(byDisplayOrder)) {
    if (c.type === "header") {
      close();
      const name = plainLine(c.localisations?.en?.textContent)?.replace(/\*\*/g, "");
      if (name) open = { header: c, name, body: [] };
      continue;
    }
    open?.body.push(c);
  }
  close();
  return sections;
}

export interface MenuSection {
  name: string;
  /** The bracketed cost or qualifier printed after the name, if any. */
  cost?: string;
  text: string;
}

/** A rule text's `■ **Name [cost]**` sections: the named options of a reward or choice menu. */
export function menuSections(text: string): MenuSection[] {
  const out: MenuSection[] = [];
  for (const chunk of text.split(/\n?■ ?/).slice(1)) {
    const m = /^\*\*([^*\n]+?)\s*(?:\[([^\]]+)\])?\*\*\n?([\s\S]*)$/.exec(chunk.trim());
    if (!m) continue;
    const name = m[1]!.trim();
    const body = m[3]!.split(/\n?■ /)[0]!.trim();
    if (!name || !body) continue;
    out.push({ name, ...(m[2] ? { cost: m[2] } : {}), text: body });
  }
  return out;
}
