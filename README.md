```
    ██████╗  █████╗ ███╗   ██╗███╗   ██╗██████╗ ███████╗███╗   ██╗
    ██╔══██╗██╔══██╗████╗  ██║████╗  ██║██╔══██╗██╔════╝████╗  ██║
    ██████╔╝███████║██╔██╗ ██║██╔██╗ ██║██████╔╝█████╗  ██╔██╗ ██║
    ██╔═══╝ ██╔══██║██║╚██╗██║██║╚██╗██║██╔══██╗██╔══╝  ██║╚██╗██║
    ██║     ██║  ██║██║ ╚████║██║ ╚████║██████╔╝███████╗██║ ╚████║
    ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═╝  ╚═══╝
      ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
     ███┃                                                   ┃███
     ███┃═══════════════════════════════════════════════════┃███
     ███┃                                                   ┃███
      ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
```

> **pannben** *(sv.)* — the frontal bone. *Att ha pannben*: to have the grit to
> keep going.

A self-hosted personal training log. Pick a program, log sets against it, fix
your mistakes afterwards, and watch the numbers move. Single user, no accounts,
no social layer, no streaks.

Runs as one container on a Synology NAS and is reachable only from the tailnet.

---

## Status

Phase 1 of 10 — **walking skeleton**. The deployment loop, the transport and the
PWA install are proven; there is nothing to log yet. Exercises land in phase 2.

## Stack

TypeScript end to end: Svelte 5 + Vite on the client, Hono on Node 22 for the
API, SQLite via better-sqlite3 with hand-written numbered migrations, Vitest for
tests. One `package.json`, one container.

The data layer (`src/data/`) has zero HTTP and zero UI imports, so it is
testable directly. Clock and filesystem access sit behind interfaces for the
same reason.

## Local development

```sh
npm install          # also installs the pre-commit privacy gate
npm run dev          # API on :8080, Vite on :5173 with /api proxied
npm test             # data layer
npm run build        # client + server into dist/
```

The database lands in `./data/pannben.db`, which is gitignored.

## Deployment

The container binds loopback; **Tailscale Serve** fronts it on the tailnet
interface. Nothing is published to the LAN or the internet.

```sh
cp .env.example .env          # fill in your own values; .env is gitignored
docker compose up -d
tailscale serve --bg https / http://127.0.0.1:8080
```

The app is then at `https://<nas>.<tailnet>.ts.net`, with a real certificate —
which is what lets it install as a PWA and work offline. `serve` is
tailnet-scoped; `funnel`, the command that would publish to the internet, is not
used. See [`docs/decisions/0002-transport-and-access.md`](docs/decisions/0002-transport-and-access.md).

Images are built by CI and published to `ghcr.io/jonasenander/pannben`; the NAS
only ever pulls a tag.

## Backups

`scripts/backup.mjs` takes a nightly `VACUUM INTO` snapshot into
`$PANNBEN_DATA_DIR/backups`, keeping 14. That is a consistent copy of a live WAL
database, which a plain file copy is not — point Hyper Backup at the snapshots
rather than at `pannben.db`.

## This repo is public

Nothing describing the real deployment may enter it: no hostnames, tailnet
names, Tailscale or LAN IPs, share paths, NAS model numbers, emails or
credentials. Real values live in `.env`; documentation uses placeholders.

A pre-commit hook and a CI job both run `npm run privacy-check`, and gitleaks
runs as a second net.

```sh
npm run privacy-check     # whole tree
node scripts/privacy-check.mjs --staged
```

## Decisions

Short records, one per phase, in [`docs/decisions/`](docs/decisions/).
