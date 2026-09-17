import type { BaseSize } from "@alpaca-software/40kdc-data";

/** Format a schema-valid base size without inventing unavailable dimensions. */
export function formatBaseSize(
  base: BaseSize | null | undefined,
): string | null {
  if (!base) return null;

  let label: string;
  switch (base.shape) {
    case "round":
      label = typeof base.diameter === "number" ? `${base.diameter}mm base` : "round base";
      break;
    case "oval":
      label =
        typeof base.width === "number" && typeof base.length === "number"
          ? `${base.width}×${base.length}mm base`
          : "oval base";
      break;
    case "flying-base":
      label = base.size ? `${base.size} flying base` : "flying base";
      break;
    case "hull":
      label = "hull";
      break;
    case "unique":
      label = "unique base";
      break;
  }

  return base.draft ? `${label} (provisional)` : label;
}
