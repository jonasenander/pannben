import { openDB, type IDBPDatabase } from "idb";

/**
 * The client's local store.
 *
 * Two jobs, deliberately separate:
 *   outbox  mutations that have not been accepted by the server yet
 *   cache   the last list the server did accept, so a screen can render
 *           offline instead of showing an empty state that reads as data loss
 */

export interface QueuedWrite {
  /** `${method} ${url}` — the coalescing key, see enqueue(). */
  key: string;
  method: "PUT" | "POST" | "DELETE";
  url: string;
  body: unknown;
  queued_at: string;
  attempts: number;
  last_error: string | null;
}

const NAME = "pannben";
const VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function idb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(NAME, VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("cache")) {
        db.createObjectStore("cache");
      }
    },
  });
  return dbPromise;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await idb()).get("cache", key)) as T | undefined;
  } catch {
    // A private window or blocked storage must not take the app down; the
    // caller falls back to the network.
    return undefined;
  }
}

export async function cachePut(key: string, value: unknown): Promise<void> {
  try {
    await (await idb()).put("cache", value, key);
  } catch {
    /* cache is an optimisation, never a requirement */
  }
}
