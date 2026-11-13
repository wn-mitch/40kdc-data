/**
 * One army code's stored army. Each code is its own Durable Object (named by the
 * code), so a read right after the write always sees it; an alarm deletes it
 * when the code expires, and a read past expiry finds nothing even if the alarm
 * has not run yet.
 */
import { DurableObject } from "cloudflare:workers";

interface Stored {
  body: string;
  expiresAt: number;
}

export class ArmyStore extends DurableObject {
  /** Stores `body` for `ttlMs`; false when this code already holds a live army. */
  async create(body: string, ttlMs: number): Promise<boolean> {
    const existing = await this.ctx.storage.get<Stored>("army");
    if (existing && existing.expiresAt > Date.now()) return false;
    const expiresAt = Date.now() + ttlMs;
    await this.ctx.storage.put<Stored>("army", { body, expiresAt });
    await this.ctx.storage.setAlarm(expiresAt);
    return true;
  }

  /** The stored army, or null when there is none or it has expired. */
  async read(): Promise<string | null> {
    const stored = await this.ctx.storage.get<Stored>("army");
    return stored && stored.expiresAt > Date.now() ? stored.body : null;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
