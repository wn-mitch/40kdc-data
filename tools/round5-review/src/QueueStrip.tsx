import type { DecisionQueue, QueueItem } from "./decision-queue";

/** How many leaf decisions are still on their way, and the ones the server refused. */
export function QueueStrip({ items, queue }: { items: readonly QueueItem[]; queue: DecisionQueue }) {
  if (!items.length) return null;
  const waiting = items.filter((item) => item.status !== "failed");
  const failed = items.filter((item) => item.status === "failed");
  const running = items.find((item) => item.status === "running");
  return <div className="wb-queue-strip" role="status">
    {waiting.length > 0 && <span>{waiting.length} decision{waiting.length === 1 ? "" : "s"} queued{running ? ` · recording “${running.label}”` : ""}</span>}
    {failed.length > 0 && <details className="wb-blocked">
      <summary>{failed.length} not recorded</summary>
      <ul>{failed.map((item) => <li key={item.key}>
        <strong>“{item.label}”</strong> <small>{item.error}</small>{" "}
        <button className="text-button" onClick={() => queue.retry(item.key)}>Retry</button>
        <button className="text-button" onClick={() => queue.drop(item.key)}>Drop</button>
      </li>)}</ul>
    </details>}
  </div>;
}
