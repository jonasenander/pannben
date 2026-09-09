# 0002 — Transport and access control

**Phase:** 1 · **Date:** 2026-09-09

## Context

The app holds personal training data and has **no login by design** — building
an auth system for one user is scaffolding for a need that does not exist. That
makes the network boundary the entire access control story, so it has to be
right.

Two constraints pulled against each other:

1. Nothing may be reachable from the home LAN or the internet.
2. A PWA needs a **secure context**. Browsers refuse to register a service
   worker over plain HTTP to a private IP, and without a service worker there is
   no offline app shell and no real install — only a bookmark.

## Decision

**Tailscale Serve, HTTPS, tailnet-only.**

- The container's published port is pinned to `127.0.0.1` in compose. Nothing
  outside the host reaches it directly.
- `tailscale serve --bg https / http://127.0.0.1:8225` makes tailscaled listen
  on 443 bound to the `tailscale0` interface only, proxying to the container.
  The LAN interface is never bound.
- Access is gated at the WireGuard layer: a device without a registered key
  cannot complete a handshake, so there is no reachable socket to attack. There
  is no login page to brute-force because there is no login page.
- The app is served at `https://<nas>.<tailnet>.ts.net` with a real
  certificate, which satisfies the secure-context requirement.

`serve` is tailnet-scoped. `funnel` — the command that publishes a service to
the internet — is a separate, explicit command that additionally requires tailnet
policy permission. It is not used.

**Prerequisites:** MagicDNS and HTTPS Certificates enabled for the tailnet;
Tailscale installed as the Synology DSM package so `serve` runs on the host
rather than inside a sidecar container.

## Port choice

The host port is **8225**, not 8080. This is collision avoidance, not hardening:
a socket bound to `127.0.0.1` is unreachable from the LAN whatever its number,
and any process already on the NAS enumerates it with one `ss -ltnp`. Port
obscurity is not a control here — Tailscale is. But 8080 is the single most
contested port on a Synology (Web Station, Portainer, and a long tail of
containers all default to it), and losing the race shows up as a container that
quietly fails to start after a reboot.

Two variables so the two sides cannot be confused for one another:

| Variable | Side | Default |
|---|---|---|
| `PANNBEN_HOST_PORT` | published on the host, what Serve proxies to | `8225` |
| `PANNBEN_PORT` | what the process listens on inside the container | `8225` |

They match so there is one number to remember. Only the host one ever needs
changing; the container's port lives in its own network namespace and cannot
collide with anything.

## Alternatives considered

**Plain HTTP bound to the Tailscale IP.** Equally closed to the LAN, and was the
original plan. Rejected because it forfeits the service worker: the app could
not cold-open without signal, and would install as a shortcut rather than an
app. Offline would have been partial by construction.

**An app-level login.** Rejected: it adds a password to manage and a session
system to get wrong, protecting a surface that is already unreachable.

## Consequences

- The MagicDNS hostname appears in public Certificate Transparency logs. It
  resolves to a CGNAT address that is not publicly routable, so the name alone
  grants nothing — but it is the one aspect of this setup that is not private,
  and it is why the repo must never name the host.
- The setup depends on Tailscale being healthy on the NAS. If tailscaled is
  down, the app is unreachable — including from the same LAN. Accepted.
- Optionally tightenable further with a tailnet ACL restricting 443 on the NAS
  to specific devices.
