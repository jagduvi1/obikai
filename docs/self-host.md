# Self-hosting Obikai

Obikai self-hosts from the same codebase as the managed service. The minimum footprint is **app +
MongoDB + Redis**, plus your own (or the bundled) **SMTP** and **S3-compatible storage**. One
`docker compose up` brings it all up; everything is configured via `.env`.

## 1. Prerequisites

- Docker + Docker Compose.
- A domain (for a real deployment) and TLS termination (the `docker-compose.prod.yml` adds Traefik
  labels; or front it with your own reverse proxy).
- An SMTP server and an S3-compatible bucket — or use the bundled **MinIO + Mailpit** sandboxes for
  local/testing via the `local` profile.

## 2. Configure

```sh
cp .env.example .env
```

Then edit `.env`. The values that **must** be set (the app refuses to boot otherwise):

- **`AUTH_JWT_SECRET`**, **`DATA_MASTER_KEY`** — strong random secrets: `openssl rand -hex 32`. The
  placeholder values in `.env.example` are rejected at boot.
- **Datastore credentials** — authentication is **on by default**:
  - `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` — the compose `mongo` service starts with `--auth` using
    these. Generate the password with `openssl rand -hex 24`.
  - `REDIS_PASSWORD` — the compose `redis` service requires it.
  - **Keep `MONGO_URI` and `REDIS_URL` in sync** — they must embed the same credentials
    (`mongodb://user:pass@mongo:27017/obikai?authSource=admin`, `redis://:pass@redis:6379`).
- **`BASE_DOMAIN`**, **`SELF_HOST_TENANT_SLUG`** — your domain and the single tenant's slug.
- **`APP_PUBLIC_URL`** — the public origin of the member/admin SPA, so emailed links (password reset,
  email verification, member invites) resolve. When unset, those emails fall back to the raw token.
- Email + storage provider settings (`SMTP_*`, `S3_*`, or the bundled sandboxes).

> **Datastore auth is mandatory here for a reason (G2).** Without it, any process on the Docker network
> has full read/write to all member data. A **hosted** deployment additionally fails to boot if
> `MONGO_URI`/`REDIS_URL` lack credentials. Self-host operators own their network isolation, but the
> compose still enforces auth by default.

## 3. Bring it up

```sh
# Local/testing with the bundled S3 + SMTP sandboxes:
docker compose --profile local up

# Self-host (your own SMTP + S3):
docker compose up -d
```

This starts `api`, `worker` (required — it runs recurring billing, dunning, reminders), `mongo`, and
`redis`. The `worker` is its own container; do not rely on running jobs inside the api.

### Web UIs

The three front-ends are published as separate static (Caddy-served) images alongside the api/worker:
`obikai-web-admin`, `obikai-web-member`, `obikai-web-platform`. Serve them behind your reverse proxy and
point each at the api (the SPAs call the API under `/api` by default — set `VITE_API_URL` if you split
origins). The exact host/path topology (e.g. admin vs. member on separate subdomains) is yours to choose;
the production compose currently wires the api + Traefik, with SPA routing left to your edge config.

## 4. Create the first owner

The first admin is seeded directly (no email round-trip, so a mail misconfig can't lock you out). Set
`BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD` in `.env`, then run the bootstrap CLI in the api
container (it is idempotent — re-running only adds a missing owner membership):

```sh
docker compose exec api node dist/cli/create-owner.js
```

## Notes

- **Enabling Mongo auth on an existing volume.** `MONGO_ROOT_USER`/`PASSWORD` create the root user only
  on the **first** init of an empty `mongo-data` volume. If you are turning auth on for a database that
  was created unauthenticated, create the user once manually (`mongosh` → `db.getSiblingDB('admin')
  .createUser(...)`) and restart with auth, or migrate to a fresh authenticated volume.
## Backups

A one-shot **backup** compose profile dumps the whole database (gzipped, timestamped) to the
`mongo-backups` volume, authenticating with `MONGO_URI`:

```sh
docker compose --profile backup run --rm backup
# → writes /backups/obikai-YYYYMMDD-HHMMSS.gz inside the mongo-backups volume
```

Schedule it from the host (cron/systemd timer) for a regular regime, and **copy archives off-box** —
either bind-mount a host path over `/backups` in the `backup` service, or `docker run --rm -v
obikai_mongo-backups:/b -v "$PWD":/out alpine cp /b/<file> /out`.

**Restore** an archive (this **drops and replaces** the data it contains — stop the api/worker first):

```sh
docker compose run --rm --no-deps --entrypoint sh backup \
  -c 'mongorestore --uri="$MONGO_URI" --archive=/backups/obikai-YYYYMMDD-HHMMSS.gz --gzip --drop'
```

> Redis holds only the BullMQ job queue (regenerated), so backing up `mongo-data` is what matters;
> `redis-data` is optional.
- **Updates.** Pull new images (`docker-compose.prod.yml` references `ghcr.io/...`) and re-`up`. Then
  apply any pending database migrations — forward-only `migrate-mongo` migrations that ship in the api
  image:

  ```sh
  docker compose exec api node dist/cli/migrate.js
  ```

  It is idempotent (a `changelog` collection records what is applied; a `changelog_lock` stops two
  runners racing), so it is safe to run on every upgrade.
