import { idb, type QueuedWrite } from "./idb.js";

/**
 * Every mutation is written here *before* it is sent, and removed only once
 * the server has accepted it. A write can therefore survive a dead connection,
 * a reload, or the app being killed mid-set.
 *
 * Rejections are kept and surfaced rather than dropped: silent data loss is the
 * one failure mode this app has no redundancy for.
 */

export type SyncState = {
  pending: number;
  /** Set when the server rejected a write — needs a human, not a retry. */
  error: string | null;
  online: boolean;
  flushing: boolean;
};

const listeners = new Set<(s: SyncState) => void>();
let state: SyncState = {
  pending: 0,
  error: null,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  flushing: false,
};

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function set(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export function syncState(): SyncState {
  return state;
}

async function count(): Promise<number> {
  try {
    return await (await idb()).count("outbox");
  } catch {
    return 0;
  }
}

/**
 * Queue a mutation and try to send it.
 *
 * Coalescing: the key is `${method} ${url}`, so editing the same row twice
 * while offline leaves one queued write carrying the final state. That is
 * exactly the last-write-wins the server applies anyway, and it keeps the
 * queue from growing with every keystroke.
 */
export async function enqueue(
  method: QueuedWrite["method"],
  url: string,
  body: unknown,
): Promise<void> {
  const write: QueuedWrite = {
    key: `${method} ${url}`,
    method,
    url,
    body,
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
  };

  await (await idb()).put("outbox", write);
  set({ pending: await count() });
  void flush();
}

/**
 * Drain the queue once. Returns how many entries it resolved, so the caller
 * can tell whether another pass is worth making.
 */
async function drain(): Promise<number> {
  let resolved = 0;
  set({ flushing: true });

  try {
    const db = await idb();
    const queued = ((await db.getAll("outbox")) as QueuedWrite[]).sort((a, b) =>
      a.queued_at.localeCompare(b.queued_at),
    );

    for (const write of queued) {
      try {
        const res = await fetch(write.url, {
          method: write.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(write.body),
        });

        if (res.ok) {
          await db.delete("outbox", write.key);
          resolved += 1;
          set({ error: null });
          continue;
        }

        // 4xx is the server saying this write is wrong. Retrying cannot fix
        // it, so stop and show it rather than spinning forever.
        if (res.status >= 400 && res.status < 500) {
          const detail = await res.json().catch(() => ({}) as { error?: string });
          await db.delete("outbox", write.key);
          resolved += 1;
          set({ error: detail.error ?? `server rejected the change (${res.status})` });
          continue;
        }

        // 5xx or anything else: keep it and try again later.
        await db.put("outbox", {
          ...write,
          attempts: write.attempts + 1,
          last_error: `HTTP ${res.status}`,
        });
        break;
      } catch (err) {
        // Network failure — expected offline. Keep the write, stop draining.
        await db.put("outbox", {
          ...write,
          attempts: write.attempts + 1,
          last_error: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }

    set({ pending: await count() });
  } finally {
    set({ flushing: false });
  }

  return resolved;
}

/**
 * Send everything queued, and resolve only once it has actually gone.
 *
 * The first version returned immediately when a flush was already running, so
 * `await flush()` was a lie: callers read the server straight afterwards and
 * got state from before their own write. In the logging screen that meant the
 * next set reused the previous set's index — two sets at index 0.
 *
 * A concurrent caller now joins the in-flight drain rather than skipping it,
 * and the loop keeps going while each pass is still resolving entries, so a
 * write enqueued mid-drain is covered by the next pass.
 */
let inflight: Promise<void> | null = null;

export function flush(): Promise<void> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      for (;;) {
        const resolved = await drain();
        // Nothing moved: either the queue is empty or the network is down.
        // Either way another identical pass would not help.
        if (resolved === 0) break;
      }
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function dismissError(): void {
  set({ error: null });
}

export async function initOutbox(): Promise<void> {
  set({ pending: await count() });
  if (typeof window === "undefined") return;

  window.addEventListener("online", () => {
    set({ online: true });
    void flush();
  });
  window.addEventListener("offline", () => set({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void flush();
  });

  void flush();
}
