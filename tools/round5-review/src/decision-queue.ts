import { useEffect, useMemo, useSyncExternalStore } from "react";

import { api } from "./workbench-api";

/**
 * Leaf decisions sent one at a time behind the page, so a reviewer can decide several in a row
 * without waiting. Each item is its own server transaction; a failed item stays in the queue with
 * the server's reason and the rest carry on.
 */

export type QueueStatus = "queued" | "running" | "failed";
export type QueueItem = {
  /** One item per key: a second decision for the same wording is ignored while the first waits. */
  key: string;
  label: string;
  path: string;
  body: unknown;
  status: QueueStatus;
  error?: string;
  /** Called with the server's reply once this item has been recorded. */
  onDone?: (result: unknown) => void;
};
export type Send = (path: string, body: unknown) => Promise<unknown>;
export type QueueHandlers = {
  /** Every recorded item whose reply names a batch, so undo can reverse it. */
  onBatch?: (batchId: string) => void;
  /** Once each time the last queued item finishes, whether or not some failed. */
  onDrained?: () => void;
};

export class DecisionQueue {
  private items: QueueItem[] = [];
  private running = false;
  private listeners = new Set<() => void>();

  constructor(private readonly send: Send, private readonly handlers: QueueHandlers = {}) {}

  snapshot = (): readonly QueueItem[] => this.items;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Queued or running items: writes the server has not finished yet. */
  get active(): boolean {
    return this.items.some((item) => item.status !== "failed");
  }

  status(key: string): QueueStatus | null {
    return this.items.find((item) => item.key === key)?.status ?? null;
  }

  /** False when an item with this key is already waiting or running. A failed one is replaced. */
  enqueue(item: Omit<QueueItem, "status" | "error">): boolean {
    const existing = this.items.find((entry) => entry.key === item.key);
    if (existing && existing.status !== "failed") return false;
    this.update([...this.items.filter((entry) => entry.key !== item.key), { ...item, status: "queued" }]);
    void this.pump();
    return true;
  }

  retry(key: string): void {
    if (!this.items.some((item) => item.key === key && item.status === "failed")) return;
    // To the back of the queue, so a retry never jumps decisions made after it.
    const item = this.items.find((entry) => entry.key === key)!;
    this.update([...this.items.filter((entry) => entry.key !== key), { ...item, status: "queued", error: undefined }]);
    void this.pump();
  }

  drop(key: string): void {
    if (this.items.some((item) => item.key === key && item.status === "failed")) this.update(this.items.filter((item) => item.key !== key));
  }

  /** Resolves when nothing is queued or running. */
  async idle(): Promise<void> {
    while (this.running || this.items.some((item) => item.status === "queued")) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  private update(items: QueueItem[]): void {
    this.items = items;
    for (const listener of this.listeners) listener();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let next = this.items.find((item) => item.status === "queued"); next; next = this.items.find((item) => item.status === "queued")) {
        const key = next.key;
        this.update(this.items.map((item) => item.key === key ? { ...item, status: "running" } : item));
        try {
          const result = await this.send(next.path, next.body);
          this.update(this.items.filter((item) => item.key !== key));
          const batchId = result && typeof result === "object" && "batch_id" in result ? (result as { batch_id: unknown }).batch_id : null;
          if (typeof batchId === "string") this.handlers.onBatch?.(batchId);
          next.onDone?.(result);
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          this.update(this.items.map((item) => item.key === key ? { ...item, status: "failed", error } : item));
        }
      }
    } finally {
      this.running = false;
    }
    this.handlers.onDrained?.();
  }
}

/** The app's one queue, re-rendering its subscribers as items move through it. */
export function useDecisionQueue(handlers: QueueHandlers): { queue: DecisionQueue; items: readonly QueueItem[] } {
  // Handlers change identity every render; the queue reads them through this stable holder.
  const holder = useMemo(() => ({ current: handlers }), []);
  useEffect(() => { holder.current = handlers; });
  const queue = useMemo(() => new DecisionQueue((path, body) => api(path, body), {
    onBatch: (batchId) => holder.current.onBatch?.(batchId),
    onDrained: () => holder.current.onDrained?.(),
  }), [holder]);
  const items = useSyncExternalStore(queue.subscribe, queue.snapshot);
  return { queue, items };
}
