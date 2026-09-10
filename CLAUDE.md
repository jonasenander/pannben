# Working on Pannben

A self-hosted, single-user gym log. Svelte 5 + Vite on the client, Hono +
SQLite on the server, one container on a NAS reachable only over Tailscale.

## Commits

- No link to a Claude session in commit messages or pull request bodies.
  `Co-Authored-By` is fine — that is authorship. A session URL points at a
  private conversation from a public repo, and it is noise in `git log`.
- The repo is public. `npm run privacy-check` runs as a pre-commit hook and in
  CI: no real hostnames, tailnet names, LAN or CGNAT IPs, share paths, NAS
  model numbers, emails or credentials. An intentional exception needs an
  inline `privacy-check:allow <reason>` so every bypass shows up in the diff.

## Practices

- **The data layer is tested first**, and it is where logic belongs. Two
  correctness bugs have hidden in row-position arithmetic inside Svelte
  components (`docs/decisions/0006`, `0010`) — ordering is data, and anything
  deciding it lives in `src/data/` where a test can reach it without a browser.
- `src/data/*.ts` imports no HTTP and no UI. The client imports from it
  directly (`numeric.ts`, `rounds.ts`) rather than keeping a second copy of a
  rule.
- One short decision record per phase in `docs/decisions/`.
- Migrations are numbered `.sql` files, applied at startup. Nothing is ever
  hard-deleted; every table carries `created_at` / `updated_at`, and
  `archived_at` / `deleted_at` where they apply.

## Before calling anything done

`npm test`, then `npm run check` (must stay at 0 errors), then drive the built
app with Playwright at 390×844 in both themes and **read the screenshots**.
Every phase so far that shipped a design bug shipped it because that last step
was skipped or skimmed. Rows get measured against their cards; the document
gets checked for horizontal scroll.

Never point the seed script or a test at the NAS database.
