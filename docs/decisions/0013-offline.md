# 0013 — Offline, for a gym with no signal

**Phase:** 9 · **Date:** 2026-09-10

## Context

The offline story was assumed to work because the outbox existed. Probing it
found that the queue was fine and everything around it was not.

What actually happened with no signal: sets **were** queued correctly and did
arrive later — but the screen never showed them, cold-opening the app lost the
session entirely, Home rendered a raw "Failed to fetch", and starting a session
was impossible.

This matters more here than in most apps. Pannben is reachable **only over
Tailscale to a NAS**, so no signal does not mean a slow server, it means no
server at all. A gym in a basement is the design case, not the edge case.

## Decision

**The screen is allowed to be ahead of the server.** A write is durable the
moment it is in the outbox, so a set row has no reason to wait for a round trip
— and offline there is no round trip to wait for. `applyLocally` puts the set
into the view immediately; the queued write follows. Online this also makes the
stepper feel instant.

**A failed re-read may not destroy state.** `reload()` used to replace the
session with an error. It now keeps what it has, and refuses to let a server
copy overwrite a local one while anything is still queued — the local copy is
the newer of the two by definition.

**Offline is a state, not an error.** No raw fetch failure reaches the screen;
the sync bar says "Offline — everything saved".

**A session can be started with no server at all.** The client caches the
programs whole (`?full=1`) and takes the snapshot itself, which is the same
rule as before — the structure is copied so a later program edit cannot rewrite
this workout — just performed on the phone. The ids are client-minted UUIDv7s
as always, so the queued write carries its final identity and replaying it is a
no-op.

**Prefill survives too**, via `/api/programs/:id/prefill`, cached alongside.
Prefill is the reason the common case is typing nothing at all; an offline
session that made you type every number would have lost most of the value.

## Background Sync is deliberately not implemented

The plan called for it. **iOS Safari does not support the Background Sync API**,
and this app runs on one iPhone — so it would have been dead code dressed as a
feature.

The mechanism that does work on iOS is already there: `initOutbox` flushes on
`online`, on `visibilitychange` and on focus. A home-screen app resuming *is*
the wake-up. Verified end to end rather than assumed.

## The bug that hid inside a `catch`

`cachePut` wrote to IndexedDB inside a blanket `try/catch` whose comment said
"cache is an optimisation, never a requirement". True, and it swallowed a real
defect for as long as it existed:

**Svelte's `$state` is a Proxy, and a Proxy cannot be structured-cloned.**
Passing a live session to `cachePut` threw `DataCloneError` every single time,
was caught, and did nothing. Caching the on-screen session silently wrote
nothing at all — so a cold open came back showing a workout with none of its
sets in it, with no error anywhere to explain why.

The write now goes through a JSON round trip, which both strips the proxy and
deep-copies away from state that is still changing. The catch stays — a private
window really must not take the app down — but it `console.warn`s now. Silence
was what made this cost an afternoon.

**The lesson:** a catch that discards the error discards the difference between
"this environment cannot do it" and "this code is wrong". At minimum, say which
one you think it was.

## Verified

Driven end to end rather than reasoned about: warm online, go offline, close
every page, cold-open, start a session, log six sets across a straight block
and a superset, cold-open **again** still offline, resume, finish, reconnect.
Six sets on the server, exactly once.
