# دارك — DARAK

**Property Management & Real Estate Operations Platform** · Arabic RTL-first · Saudi market · SAR

> إدارة أملاكك. بصورة أوضح. — كل عقار. كل عقد. كل ريال. كل مهمة. في مكان واحد.

DARAK is a multi-tenant SaaS operating system for real-estate offices: owners → properties → units → tenants → contracts → installments → collections (property-first, statutory grace rule) → payment receipts → expenses → owner statements, with an assistant layer (Gemini, optional), tasks, documents, notifications, reports, audit log, integrations, and portals for owners, tenants, and the platform team.

## Quick start

```bash
npm i -g pnpm@9             # once
pnpm install
pnpm db:reset               # creates packages/db/prisma/schema/dev.db (SQLite), empty — no example data
pnpm dev                    # http://localhost:3000 → landing page → "ابدأ برقم جوالك"

# optional demo office for exploring: pnpm db:reset:demo · then BASE=http://localhost:3000 pnpm smoke (route + isolation test)
# production build: pnpm build && pnpm start
```

**Sign-in is by mobile number.** Enter any Saudi mobile (05XXXXXXXX); a 6-digit code is sent by SMS. In development (or on a staging deploy with `OTP_ECHO=always` + `ALLOW_OTP_ECHO_IN_PROD=1`) the code is shown on screen, so the whole product can be tested before an SMS vendor is connected; in production without those flags login codes go only by SMS. Only numbers the team registered receive a code (invite-only): a new office fills **اطلب حسابًا** on the landing page, the request lands in `/admin/requests`, and the team opens the office from there. A number that belongs to an owner or tenant record opens their portal automatically.

Demo office (only after `pnpm db:reset:demo`):

| Mobile | Role |
|---|---|
| 0500000001 | مدير المكتب — full office operating system |
| 0500000002 | مدير عقار — scoped to assigned properties |
| 0500000004 | موظف تأجير |
| 0500000005 | محصل — action queue dashboard |
| 0500000007 | محاسب — payments, reconciliation, statements |
| 0500000009 | مدقق — read only |
| 0500000010 | بوابة المالك |
| 0500000011 | بوابة المستأجر |
| 0500000000 | إدارة منصة دارك (Super Admin) |

## Architecture

- **Next.js 15** App Router, React Server Components + Server Actions, TypeScript strict
- **Prisma 6 + SQLite** (swap `provider` to PostgreSQL for production; schema is provider-agnostic)
- **Tailwind v4** with DARAK design tokens (`src/app/globals.css`) from the brand identity
- **Auth**: mobile number + one-time SMS code (`src/lib/otp.ts`, hashed codes, 5 min / 5 attempts / 60 s resend), signed cookie sessions (jose) backed by revocable DB sessions with device/IP tracking. No passwords.
- **Permission Engine**: RBAC + Data Scope (`src/lib/permissions.ts`) — every page and action checks auth → permission → organization → scope (BR-005)
- **Workflow / Financial Engine** (`src/lib/engine.ts`): computes installment & contract statuses, opens collection cases, scores priority, detects broken promises, escalates, runs renewal workflow (90/60/30), SLA alerts, document expiry tasks, owner statement math with ownership percentages and historical ownership
- **Audit Layer** (`src/lib/audit.ts`): append-only log with user/action/entity/old/new/IP/device
- **Integration Layer**: adapter pattern (WhatsApp, SMS, Email, Bank) isolated from core logic
- **Scheduled jobs**: `GET /api/cron/run` (call from any scheduler) · health: `GET /api/health`

## Layout

```
src/app/(app)/*   Office Operating System (staff)
src/app/owner/*   Owner Portal
src/app/tenant/*  Tenant Portal
src/app/admin/*   Dark Platform Admin
src/lib/*         engines, auth, permissions, audit, constants (Arabic labels), formatting
apps/web/         Next.js app (src, public, tests, scripts/seed.ts, scripts/smoke.ts)
packages/db/      @darak/db — Prisma multi-file schema, migrations, client singleton, DB scripts
brand/            logo marks + brand identity document
```

## Production

- **Deploy:** see [DEPLOYMENT.md](DEPLOYMENT.md) — Vercel or Docker Compose (Postgres + Caddy TLS + cron + nightly backups).
- **Operate:** see [RUNBOOK.md](RUNBOOK.md) — monitoring, backups/restore, incident playbooks, security operations.
- **Config:** copy `.env.example`; empty provider keys keep that feature in simulated mode (logged, never sent).
- **Verify:** `pnpm typecheck` · `pnpm test` (unit: engine, permissions) · `pnpm smoke` (routes × roles + isolation) · CI in `.github/workflows/ci.yml`.
- **Security:** OTP throttling per number and per IP, signed revocable sessions, CSP/HSTS headers, private file delivery, append-only audit log, PDPL request intake.
- **Integrations:** Resend (email), Authentica (login codes) / Unifonic / Msegat (SMS), WhatsApp Cloud API, Gemini assistant (optional), S3-compatible storage.

See `docs/ENGINEERING.md` for engineering conventions.
