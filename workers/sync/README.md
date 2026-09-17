# 40kdc-sync

Cloud documents, shortlinks, and live shared-editing sessions for the
alpacasoft app family (list-builder, teams-planner, shadowboxing saves), at
**sync.alpacasoft.dev**.

**Patron-gated creation, free opening**: every write requires an entitlement
token minted by [keys.alpacasoft.dev](https://keys.alpacasoft.dev) and
verified here with a pinned Ed25519 **public** key — this worker holds no
secrets. Resolving a shortlink or joining a live session is anonymous.

## Architecture

- **Documents + shortlinks → D1** (`40kdc_sync`): small JSON snapshots keyed
  by the token's `sub` (a Patreon user id, or `key:<label>` — holders of one
  access key share a namespace). `PUT /docs/:id` takes an `ifUpdatedAt`
  optimistic-concurrency hint and 409s with the current state instead of
  clobbering a cross-device edit.
- **Live sessions → Durable Objects**: `DocRoom` (one per 6-char code) holds
  the authoritative document, applies validated total-ordered op batches
  (`src/apply-ops.ts`, shared verbatim with clients via
  `examples/_shared/doc-protocol.ts`), and always welcomes with the full doc.
  `SyncRegistry` (singleton) caps concurrent rooms — the hard spend ceiling.
  Idle rooms expire via alarm and release their slot.
- **Live doc links (doc-bound rooms)**: a cloud doc carries durable
  editor/viewer share tokens (`POST /docs/:id/share`); opening
  `?d=<docId>&token=` joins a `DocRoom` keyed `doc:<id>` that hydrates from
  the D1 row and persists edits back (debounced, on last-leave, and at idle
  eviction) — the Google-docs model. While a room is live, snapshot `PUT`s
  409 (`doc_live`); `DELETE` always wins and tears the room down. When the
  room can't be joined (capacity), `GET /docs/:id/shared?token=` serves the
  at-rest doc read-only.

> **Payload shapes**: the worker is shape-agnostic, but the example apps
> store uploads in their *storage* shape (`TeamPlan` / roster-json) while
> live sessions replicate an *id-keyed session* shape. A doc that has been
> live-edited is therefore stored session-shaped; the apps normalize on every
> payload ingest (`fromCloudPayload`) and convert back to the storage shape
> before minting snapshot shortlinks, so `?s=` links stay interoperable
> across apps. Anything else reading `team-plan`/`list` doc payloads
> directly needs the same normalizer.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | liveness |
| GET | `/links/:code` | — | resolve a shortlink → `{kind, payload}` |
| GET | `/session/:code/ws?token=` | link token | WebSocket → DocRoom (ephemeral) |
| GET | `/docs/:id/ws?token=` | share token | WebSocket → doc-bound DocRoom (live doc link) |
| GET | `/docs/:id/shared?token=` | share token | anonymous at-rest read → `{kind, name, payload, updated_at, role}` |
| POST | `/links` | Bearer | mint an 8-char shortlink |
| POST | `/session` | Bearer | create a live room seeded with `{kind, payload}` → `{code, editorToken, viewerToken}` |
| GET | `/docs?kind=` | Bearer | owner's docs (metadata only, + `shared` flag) |
| POST | `/docs` | Bearer | create `{kind, name, payload}` |
| GET/PUT/DELETE | `/docs/:id` | Bearer (owner) | fetch / update (`ifUpdatedAt` → 409 conflict; 409 `doc_live` while a room is live) / delete |
| POST | `/docs/:id/share` | Bearer (owner) | mint durable share tokens (idempotent; `{regenerate: true}` rotates) |

Document kinds: `list` (canonical roster-json), `team-plan` (teams-planner
plan), `threat-matrix` (teams-planner live opponent triage), `sb-save`
(shadowboxing save), `mission-matrix` (WTC scoresheet). The worker's
`DOC_KINDS` and the `CHECK (kind IN …)` constraints on `documents` and
`shortlinks` must list the same set — a test writes one row per kind through
both tables to hold them together.
Shortlink URLs are `?s=CODE` on any app origin — shadowboxing's importer
resolves a pasted list-builder link the same way.

## Cost levers (wrangler.jsonc vars)

`MAX_DOCS_PER_OWNER=100`, `MAX_LINKS_PER_OWNER=200`,
`MAX_PAYLOAD_BYTES=262144`, `MAX_DOC_SESSIONS=20`,
`DOC_SESSION_TTL_MINUTES=120`, `MAX_EDITORS=10`, `MAX_VIEWERS=20`,
`DOC_PERSIST_SECONDS=15`.

## Develop

```bash
cd workers/sync
npm install     # own lockfile — NOT an npm workspace (the monorepo pins
                # vitest 2.x; the workers pool needs vitest 3 + current workerd)
npm test
npm run typecheck
```

## Operator bootstrap (one-time, per environment)

1. **Keys service first** — deploy [alpacasoft-keys](https://github.com/wn-mitch/alpacasoft-keys)
   (see its README: secrets, Patreon redirect URI, key migration, passkey
   enrollment).
2. **Create the database**: `npx wrangler d1 create 40kdc_sync`, then commit
   the printed id into `wrangler.jsonc` `database_id` (replacing the all-zeros
   placeholder — the deploy workflow self-skips until it is real).
3. **Pin the public key**: fill `ENTITLEMENT_PUBLIC_KEYS` in `wrangler.jsonc`
   from `GET https://keys.alpacasoft.dev/auth/public-key`. (Also set it in
   shadowboxing's session-worker `wrangler.jsonc` for the dual-verify window.)
4. **Token scope**: the repo's `CLOUDFLARE_API_TOKEN` secret needs D1:Edit
   added for the migration step in `.github/workflows/deploy.yml`.
5. Push to main — CI applies migrations and deploys; the custom domain
   `sync.alpacasoft.dev` is claimed on first deploy.

Key rotation: mint a new keypair in the keys service, append the new public
key to every consumer's `ENTITLEMENT_PUBLIC_KEYS` (comma-separated), deploy
consumers, flip the keys service's `ENTITLEMENT_PRIVATE_KEY`, then remove the
old pin after 7 days (token TTL).
