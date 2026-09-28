# DARAK — Deployment Guide (Vercel + Neon + Cloudflare R2)

Chosen stack: **Vercel** (app + cron), **Neon** (PostgreSQL), **Cloudflare R2** (file uploads — Vercel's disk is not persistent). SQLite is for local development only. The Docker Compose stack in `docker-compose.yml` remains a self-hosted alternative (see the end).

Every empty messaging/AI key keeps that feature in **simulated** mode (logged, never sent). The database is **not** optional: the app refuses to start on Vercel with SQLite. File storage (R2) can come later — until it is configured, uploads are switched off with a clear Arabic message and everything else works.

Plan: DARAK is a commercial service, so use **Vercel Pro** (the Hobby plan is for non-commercial use and allows only daily crons). On Hobby everything works, but the automatic status run happens once a day (plus whenever staff open the dashboard).

---

## Step 0 — Commit everything (2 minutes)

Vercel builds from git. Commit the whole working tree in one go (a partial commit fails the build with "Module not found"):

```bash
git add -A
git commit -m "Production readiness"
```

Then create an empty GitHub repository and push:

```bash
git remote add origin https://github.com/<you>/darak.git
git push -u origin master
```

> Git history contains an old `dev.db` with synthetic demo data (no real people, no secrets). If the repository may ever become public, remove it first: `git filter-repo --invert-paths --path packages/db/prisma/schema/dev.db`.

## Step 1 — Postgres on Neon (10 minutes)

**Easiest:** Vercel project → **Storage** → **Create Database** → **Neon** → connect it to the project (Production + Preview). Vercel then sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) itself, and every Vercel build applies pending migrations with the direct URL (`apps/web/vercel.json`). Skip the manual steps below in that case.

Manual alternative:


1. <https://neon.tech> → sign up → **New project** → name `darak`, region **AWS eu-central-1 (Frankfurt)** (next to Vercel `fra1`), Postgres 16.
2. **Connect** → copy **two** URLs:
   - **Direct** (pooling off) — for migrations and backups only:
     `postgresql://neondb_owner:XXXX@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
   - **Pooled** (pooling on, host contains `-pooler`) — for the app. Append `&connect_timeout=15&connection_limit=5`:
     `postgresql://neondb_owner:XXXX@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=15&connection_limit=5`
3. Apply the schema from your machine with the **direct** URL (bash / Git Bash):
   ```bash
   DATABASE_URL='<direct url>' pnpm db:generate
   DATABASE_URL='<direct url>' pnpm db:migrate:deploy   # 0001_init = full schema
   ```
   Expected last line: `All migrations have been successfully applied.`
4. Verify there is no drift:
   ```bash
   DATABASE_URL='<direct url>' pnpm --filter @darak/db exec prisma migrate diff --from-url '<direct url>' --to-schema-datamodel prisma/schema --exit-code
   ```
   Exit code 0 / `No difference detected` = done.
5. Regenerate the local SQLite client again: `pnpm db:generate` (without `DATABASE_URL` set, it reads your `.env`).

Never run `pnpm db:reset`, `pnpm db:reset:demo` or `pnpm db:seed:demo` against Neon (the demo seed refuses a non-SQLite database anyway).

## Step 2 — Uploads on Cloudflare R2 (10 minutes, can wait)

Without R2 the app runs; forms that attach files say uploads are not enabled yet.


1. <https://dash.cloudflare.com> → **R2** → **Create bucket** → `darak-uploads`, location **EEUR**.
2. **Manage R2 API tokens** → **Create API token** → **Object Read & Write**, scoped to `darak-uploads` → copy **Access Key ID** and **Secret Access Key**.
3. Your endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (account id in the R2 overview URL).

Uploads are capped at **4 MB per file** on Vercel (the platform rejects larger request bodies); the forms say so. Docker/VPS allows 20 MB.

## Step 3 — Secrets (2 minutes)

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # CRON_SECRET (a different value)
```

Production refuses to start when either is missing, shorter than 32 characters, or still `change-me`.

## Step 4 — Vercel project (15 minutes)

1. <https://vercel.com/new> → import the repository.
2. **Root Directory: `apps/web`** (Settings → General). Keep **"Include files outside the root directory in the Build Step"** enabled. Framework: Next.js. Leave build/install commands empty — `apps/web/vercel.json` sets them (`pnpm install --frozen-lockfile`, then `pnpm --filter @darak/db generate && pnpm db:migrate:deploy && pnpm --filter web build`) and the cron. Migrations use `DATABASE_URL_UNPOOLED` (or `DIRECT_URL`) when present, because Neon's pooler cannot run them.
3. **Environment Variables** — Production:

   | Variable | Value | Notes |
   |---|---|---|
   | `DATABASE_URL` | Neon **pooled** URL from Step 1 | also needed at build time (the Prisma client is generated for PostgreSQL from it) |
   | `AUTH_SECRET` | Step 3 | signs sessions and login codes; rotating it signs everyone out |
   | `CRON_SECRET` | Step 3 | Vercel sends it as `Authorization: Bearer` to `/api/cron/run` |
   | `APP_URL` | `https://app.<your-domain>` | links in emails and statements |
   | `DATABASE_URL_UNPOOLED` | Neon **direct** URL | set automatically by the Neon integration; used only for migrations during the build |
   | `STORAGE_PROVIDER` | `s3` | once R2 exists (without it uploads stay off) |
   | `S3_BUCKET` | `darak-uploads` | |
   | `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | |
   | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Step 2 | |
   | `S3_REGION` | `auto` | |
   | `S3_FORCE_PATH_STYLE` | `true` | R2 needs path style |
   | `SUPER_ADMIN_PHONES` | your mobile(s), e.g. `05XXXXXXXX` | become platform admins on first sign-in |
   | `SMS_PROVIDER` | `authentica` (or `unifonic` / `msegat`) | without a working SMS provider nobody can sign in |
   | `AUTHENTICA_API_KEY` | the raw key (`$2y$10$…`) | paste as is in Vercel. Authentica sends login codes only; SMS reminders need Unifonic/Msegat |
   | `SUPPORT_PHONE`, `SUPPORT_EMAIL` | team WhatsApp number and email | landing page, login, help; notified on every account request |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Vercel uses the pinned pnpm 9.15.9 |

   Optional: `RESEND_API_KEY` + `EMAIL_FROM` (verified domain), `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN`, `GEMINI_API_KEY` (assistant wording), `SENTRY_DSN`, `LOG_LEVEL=info`.

   Must be **unset** once real users sign in: `OTP_ECHO` (or `never`), `ALLOW_OTP_ECHO_IN_PROD`, `LOGIN_ALLOWED_PHONES`.
   `LOGIN_ALLOWED_PHONES` (comma-separated mobiles) is only for a closed test: while set, nobody else receives a login code.

   **Preview** environment: its own `DATABASE_URL` (a Neon branch, via the Neon–Vercel integration) and **no** SMS/WhatsApp/Resend keys, so branch deploys never touch live data or text real tenants. A Preview build without `DATABASE_URL` fails on purpose.
4. **Deploy** (3–5 minutes).
5. **Cron**: `apps/web/vercel.json` runs `/api/cron/run` daily at 03:00 UTC (06:00 Riyadh) — valid on every plan. On **Pro**, change the schedule to `*/15 * * * *` for 15-minute status updates. Runs never overlap: the engine takes a database lease.
6. **Domain**: Settings → Domains → add `app.<your-domain>` → add the CNAME at your DNS provider. TLS is automatic.

## Step 5 — First login (10 minutes)

1. `curl https://app.<domain>/api/health` → `{"status":"ok",…}`.
2. `curl -H "Authorization: Bearer <CRON_SECRET>" https://app.<domain>/api/cron/run` → `{"ok":true,…}`.
3. Open `https://app.<domain>` → **لديك حساب؟ ادخل برقم جوالك** → enter a number from `SUPER_ADMIN_PHONES` → the SMS code arrives → you land in `/admin`.
   - Stakeholder test before the SMS vendor is live: set `OTP_ECHO=always` **and** `ALLOW_OTP_ECHO_IN_PROD=1`, redeploy — the code shows on screen. Remove **both** before real users sign in.
4. Create the first office at `/admin/organizations/new` (the manager's mobile is their login). Offices do not self-register: they submit **اطلب حسابًا** on the landing page and appear in `/admin/requests`, where **إنشاء المكتب** prefills the form.
5. In the office: Settings → Organization → name, CR, VAT number, phone, **collection account (bank + IBAN, shown to tenants)**, grace policy, approval limits.
6. Enter owners → properties → units → contracts (or import from Excel at `/import`). Run two weeks in parallel with the old sheets.

## Step 6 — Backups and monitoring

- **Neon** keeps point-in-time restore. Do one restore drill: Neon → Branches → Restore to a new branch → connect → `pnpm db:studio`.
- **Off-site nightly dump** (`.github/workflows/backup.yml`, 03:30 Riyadh): add repository secrets `BACKUP_DATABASE_URL` (Neon **direct** URL), `BACKUP_S3_BUCKET` (e.g. `darak-backups`, a second R2 bucket), `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Run it once by hand (Actions → Nightly database backup → Run workflow). Restore: `pg_restore --clean --if-exists -d '<direct url>' darak-YYYYMMDD-HHMM.dump`.
- **Uptime**: monitor `https://app.<domain>/api/health` every 5 minutes (a 1-minute check keeps Neon awake and costs compute).
- **Logs**: Vercel → Logs (JSON lines). Retention is short (1 day on Pro) — set `SENTRY_DSN` for errors, or a log drain.
- **Cron health**: Vercel → Settings → Cron Jobs shows every run; the response lists per-office updates.

## Schema changes after launch

`0001_init` is frozen once applied. For every later change:

```bash
MIGRATE_FROM_URL='<Neon direct url>' pnpm --filter @darak/db migrate:new <short_name>   # writes 000N_<name>/migration.sql (read-only diff)
# review the SQL, commit it, then:
DATABASE_URL='<Neon direct url>' pnpm db:migrate:deploy
git push                                                                                 # Vercel deploys
```

CI (`.github/workflows/ci.yml`) runs type-check, unit tests, the demo seed, build and the route smoke test on every push; merge only green builds.

## Alternative: Docker on a VPS

`docker compose up -d --build` runs Postgres + app + Caddy (automatic TLS) + a 15-minute cron + a nightly `pg_dump`. Set `DOMAIN`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET` and the SMS keys in `.env`. Uploads persist in the `uploads` volume (`UPLOAD_DIR=/app/uploads`) unless `STORAGE_PROVIDER=s3`. The container applies migrations on start and refuses to start if a migration fails.
