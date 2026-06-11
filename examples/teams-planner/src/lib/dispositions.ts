/**
 * Per-disposition hue palette + the inline-style math the pills render with.
 *
 * Colors live here (not in `_shared/matchup-grid.ts`) to keep the blast radius
 * to this app — mission-matrix doesn't colorize dispositions. The hues are
 * deliberately off the app's teal accent so a colored pill never reads as
 * "selected", and span the wheel so all five are distinguishable.
 *
 * Pills must use inline `style=` rather than Tailwind utilities: Tailwind v4
 * purges classes it can't see as literals, so a `bg-[${hue}]` built at runtime
 * would be stripped from the build. Everything here is pure (string in, string
 * out), so it's unit-testable without a DOM.
 */
import type { ForceDispositionId } from "@alpaca-software/40kdc-data";

/** Five distinct hues, one per launch disposition. */
export const DISPOSITION_COLORS: Record<ForceDispositionId, string> = {
  "take-and-hold": "#f5a524", // amber
  disruption: "#f43f5e", // rose
  "purge-the-foe": "#a855f7", // violet
  "priority-assets": "#3b82f6", // blue
  reconnaissance: "#22c55e", // green
};

/** Pill appearance tiers. `could`/`pref`/`want` are the desire ladder (○ ● ★). */
export type PillTier = "could" | "pref" | "want" | "uncovered" | "tag";

/** The desire ladder rendered as bare glyphs (matrix cells, band headers). */
export const TIER_SYMBOL = { could: "○", pref: "●", want: "★" } as const;
export const TIER_LABEL = { could: "could", pref: "pref", want: "want" } as const;

/** "#rrggbb" → `[r, g, b]` (0–255). Assumes a 6-digit hex from the table above. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Black or near-white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableFg(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#0b0b0d" : "#f5f5f7";
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The inline `style` string for a pill of the given disposition + tier. Returns
 * `""` for `uncovered` (the component styles that neutrally with classes).
 *   could → faint hue tint, hue text + border (○)
 *   pref  → transparent, solid hue outline + hue text (●)
 *   want  → solid hue fill, contrast-checked dark/light text (★)
 *   tag   → hue text only (tiny fd badges)
 */
export function pillStyle(disposition: ForceDispositionId, tier: PillTier): string {
  const hue = DISPOSITION_COLORS[disposition];
  switch (tier) {
    case "could":
      return `background:${rgba(hue, 0.16)};color:${hue};border:1px solid ${rgba(hue, 0.4)};`;
    case "pref":
      return `background:transparent;color:${hue};border:1px solid ${hue};`;
    case "want":
      return `background:${hue};color:${readableFg(hue)};border:1px solid ${hue};`;
    case "tag":
      return `color:${hue};`;
    case "uncovered":
      return "";
  }
}
