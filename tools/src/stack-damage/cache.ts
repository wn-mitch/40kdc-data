import type { ComparePhase } from "../compare.js";

/** Cache namespace for one faction × target × phase matrix cell. */
export class DamageCellCache<T> {
  readonly scope: string;
  readonly values = new Map<string, T>();

  constructor(factionId: string, targetId: string, phase: ComparePhase) {
    this.scope = `${factionId}::${targetId}::${phase}`;
  }

  get(key: string): T | undefined {
    return this.values.get(`${this.scope}::${key}`);
  }

  set(key: string, value: T): void {
    this.values.set(`${this.scope}::${key}`, value);
  }
}
