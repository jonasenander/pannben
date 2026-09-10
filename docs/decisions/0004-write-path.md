# 0004 — The write path: client ids, an outbox, idempotent upserts

**Phase:** 2 · **Date:** 2026-09-10

## Context

Phase 2 is the first slice that stores something worth keeping, so it is also
where the write path every later phase inherits gets decided. Sets are logged in
a gym with unreliable signal; a write that is lost, duplicated, or silently
reordered there costs real training history that nothing else can reconstruct.

## Decision

**Client-minted UUIDv7 ids.** A row created offline owns its final identity
immediately — no temporary id, no server-side reconciliation, no rewriting
foreign keys once the queue drains. v7 is time-ordered, so rows sort by creation
without a separate column and index inserts stay at the hot end of the btree.

**One write verb.** `PUT /api/exercises/:id` handles create, rename, archive,
unarchive and delete, because all of them are field changes on one row. Four
endpoints would have been four things to make idempotent instead of one.

**Idempotent upsert, last-write-wins.**

```sql
INSERT … ON CONFLICT(id) DO UPDATE SET …
WHERE excluded.updated_at >= exercise.updated_at
```

Replaying the queue is a no-op; a replay that arrives after a newer edit loses
rather than resurrecting a stale value.

**An outbox in IndexedDB, written before the request.** Queued writes are keyed
`${method} ${url}`, so editing the same row twice offline leaves one write
carrying the final state — which is what last-write-wins would have produced
anyway, and keeps the queue from growing per keystroke.

A 4xx is the server saying the write is wrong; retrying cannot fix it, so it is
removed and surfaced to the user. A 5xx or a network failure keeps the write and
stops the drain, preserving order.

**A read cache, so an unreachable server does not look like data loss.** The
list renders from the last accepted response with an explicit "showing the last
synced copy" line rather than an empty state.

## Consequences

- Every later table follows this shape. Sets, sessions and programs need no new
  sync machinery.
- Ordering is preserved only per queue, not per row. With one user on one phone
  that is sufficient; anything stronger would be the speculative complexity this
  project set out to avoid.
- `updated_at` is supplied by the client, so a phone with a badly wrong clock
  could lose an edit. Accepted: the alternative is server-assigned versions,
  which reintroduce the reconciliation step client ids exist to remove.

## What this caught

Testing the reload-while-offline path found the app rendering blank: the service
worker precached `/` and the icons, but Vite emits content-hashed bundles, and
on a first visit those are fetched before the worker controls the page — so the
runtime cache never saw them. `scripts/gen-sw.mjs` now reads the real filenames
out of `dist/` at build time. A hand-maintained list could not have stayed
correct.
