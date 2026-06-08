/** A 2D point. The tracer works in image pixels internally and converts to
 * board inches (y-down) only at export time. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Edition + dataslate pair carried by every dataset entity. */
export interface GameVersion {
  edition: string;
  dataslate: string;
}

/** Default game version for new traces. Matches the edition the live terrain
 * and detachment data is authored against. */
export const DEFAULT_GAME_VERSION: GameVersion = {
  edition: "11th",
  dataslate: "pre-launch-provisional",
};
