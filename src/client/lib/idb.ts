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
  method: "PUT" | "POST" | "PATCH" | "DELETE";
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
  if (value === undefined) return;
  try {
    /**
     * The JSON round trip is not decoration.
     *
     * Svelte's `$state` is a Proxy, and a Proxy cannot be structured-cloned
     * into IndexedDB — it throws `DataCloneError`. The blanket catch below
     * swallowed exactly that, so caching a live session wrote nothing at all
     * and a cold open came back showing a workout with none of its sets in it.
     * Everything cached here arrived as JSON, so a round trip both strips the
     * proxy and deep-copies away from state that is still changing.
     */
    await (await idb()).put("cache", JSON.parse(JSON.stringify(value)), key);
  } catch (err) {
    // A private window or blocked storage must not take the app down — but say
    // so once rather than never. Silence here is what hid the bug above.
    console.warn("pannben: cache write failed", key, err);
  }
}
