export type StoreSourceFragment = {
  fragment: "RAW_TEXT" | "WHEN" | "TARGET" | "EFFECT" | "RESTRICTIONS";
  start_byte: number;
  end_byte: number;
  text: string;
};

export type StoreSourceAssembly = {
  text: string;
  fragments: StoreSourceFragment[];
};

const STRUCTURED_FIELDS = [
  { field: "when", fragment: "WHEN" },
  { field: "target", fragment: "TARGET" },
  { field: "effect", fragment: "EFFECT" },
  { field: "restrictions", fragment: "RESTRICTIONS" },
] as const;

/**
 * Assemble local raw-source records without normalising any inner prose.
 *
 * The returned byte boundaries refer to the exact assembled UTF-8 text. This
 * is shared by corpus tooling and the private workbench so their offsets stay
 * interchangeable.
 */
export function assembleStoreSource(entry: Record<string, unknown>): StoreSourceAssembly | null {
  if (typeof entry.raw_text === "string" && entry.raw_text.trim()) {
    const text = entry.raw_text.trim();
    return {
      text,
      fragments: [{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(text), text }],
    };
  }

  const parts = STRUCTURED_FIELDS.flatMap(({ field, fragment }) => {
    const value = entry[field];
    if (typeof value !== "string" || !value.trim()) return [];
    return [{ fragment, text: value.trim() }];
  });
  if (!parts.length) return null;

  let startByte = 0;
  const fragments = parts.map(({ fragment, text }, index) => {
    if (index) startByte += 1; // The newline joining adjacent structured fields.
    const endByte = startByte + Buffer.byteLength(text);
    const boundary: StoreSourceFragment = {
      fragment,
      start_byte: startByte,
      end_byte: endByte,
      text,
    };
    startByte = endByte;
    return boundary;
  });

  return { text: parts.map((part) => part.text).join("\n"), fragments };
}

/** The store's two record shapes reduced to one source string. */
export function storeSource(entry: Record<string, unknown>): string | null {
  return assembleStoreSource(entry)?.text ?? null;
}
