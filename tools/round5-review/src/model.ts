/**
 * Convert a browser text selection (UTF-16 code-unit offsets into `text`) into UTF-8 byte
 * offsets, the unit every workbench span uses.
 */
export function utf8Selection(text: string, start: number, end: number): { start: number; end: number; text: string } {
  if (start < 0 || end < start || end > text.length) throw new Error("Invalid text selection.");
  const encoder = new TextEncoder();
  return {
    start: encoder.encode(text.slice(0, start)).length,
    end: encoder.encode(text.slice(0, end)).length,
    text: text.slice(start, end),
  };
}
