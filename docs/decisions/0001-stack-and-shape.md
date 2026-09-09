# 0001 — Stack and project shape

**Phase:** 1 · **Date:** 2026-09-09

## Context

A single-user gym log, used on a phone, self-hosted on a Synology NAS. Writes
must survive a gym with poor signal, so the client needs a real offline queue —
which rules out a purely server-rendered app. The data layer must be testable
without a browser or an HTTP server, because set-logging and import/export are
where a bug would cost real training history.

## Decision

TypeScript end to end:

- **Client** — Svelte 5 + Vite, SPA. Small bundle, no virtual DOM cost on a phone.
- **API** — Hono on Node 22. ~20 endpoints; no framework ceremony needed.
- **Database** — SQLite via better-sqlite3, WAL mode, hand-written numbered
  `.sql` migrations.
- **Tests** — Vitest, same runner for data layer and client.
- **Image** — multi-stage `node:22-alpine`, `linux/amd64` only.

`src/data/` imports nothing from HTTP or UI. Clock and filesystem sit behind
interfaces (`src/data/clock.ts`) so timing and persistence are deterministic in
tests.

No ORM. For a schema this size an ORM is exactly the speculative abstraction the
project set out to avoid.

## Alternatives considered

**Go backend + Svelte client.** ~20 MB image and lower idle memory, which
matters on modest NAS hardware. Rejected: it splits the codebase across two
languages for a workload that is one person pressing buttons a few times a week,
and the maintenance burden falls on one person.

**Server-rendered HTML (htmx or similar).** Simpler, but an offline write queue
needs real client-side state, and offline is a hard requirement.

## Consequences

- One language, one dependency tree, one container.
- Native addon (better-sqlite3) means the Docker build carries a toolchain and
  rebuilds against the runtime image — a slower build for a simpler runtime.
- Node's idle memory is higher than a Go binary's. Acceptable for one user.
