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

![Four screens: the home dashboard with pinned progression charts and a body
metric, a superset being logged round by round, an exercise chart with a trend
line, and the session history](docs/img/screens-light.png)

---

## What it does

- **Exercises** — six metric types (barbell, dumbbell, bodyweight, bodyweight
  plus load, cardio, hold), renameable and archivable without breaking history.
- **Programs** — blocks of single exercises or supersets, with target sets.
- **Logging** — pick a program, log sets against a snapshot of it, superset
  round by round. Every field prefills from the same set index of the last
  session, so the common case is typing nothing at all.
- **History** — find last week's session and correct the set where you typed
  100 instead of 10.
- **Charts** — volume, top set and estimated 1RM per exercise, with a trend
  line fitted against calendar days rather than session count.
- **Body metrics** — whatever you track, in whatever unit, on the home screen.
- **Backup** — export everything as JSON; restore it in one transaction behind
  a typed confirmation.

Installed as a PWA and usable with no signal: sets, corrections and even
starting a session are queued on the phone and land exactly once when the
connection comes back.

![The same three screens in dark mode: a superset mid-session, an exercise
chart, and the program editor](docs/img/screens-dark.png)

Dark mode is its own palette rather than an inversion of the light one — many
gyms are dim, and a flipped light theme reads wrong in them. Every colour is a
token defined twice, and both were checked for contrast.

Still to come: a second visual pass now that real data has stressed the design.

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
npm run dev          # API on :8225, Vite on :5173 with /api proxied
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
sudo tailscale serve --bg http://127.0.0.1:8225
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
