# DARAK — Production Readiness: the full brief (A → Z)

Date: 2026-09-21. This is the working brief for taking DARAK from demo to a product a Saudi property-management office runs its money through. Each item carries a status: **done** (in the codebase today), **todo** (engineering can do it alone), **needs owner** (a decision, credential or business fact only the product owner can supply). Read it as a prompt: every section states the intent, the rule, and the definition of done.

---

## 0. Who this is for and what "good" means

**User:** a Saudi real-estate office (مكتب إدارة أملاك) with 1–15 staff managing 50–2,000 units for third-party owners. The office lives on three numbers: what was collected this month, what is late, and what it owes each owner. Everything else is supporting detail.

**Principles**
1. Property-first. Every question starts from the property; units, tenants, contracts, claims hang off it.
2. One queue per kind of work. Claims are the collection queue, tasks are for everything without a queue. Never two lists for the same work.
3. Fewer states, more dates. A status exists only when a human decision changes it. Anything a date can express is derived.
4. Nothing financial is deleted. Reverse, cancel, archive.
5. Arabic, calm, plain. Saudi vocabulary (سند قبض، دفعة، كشف حساب المالك، مهلة السداد، تنفيذ عبر ناجز). No hype adjectives.
6. Works with no keys. Every integration (messaging, assistant, payments) degrades to a logged simulation; the office is never blocked.

---

## A. Domain logic

| # | Rule | Status |
|---|---|---|
| A1 | Installment statuses: UPCOMING / DUE (due date reached, inside grace) / OVERDUE / PARTIALLY_PAID / PAID / WAIVED. Grace = statutory 15 days (monthly, quarterly) or 30 days (semi-annual, annual), overridable per office. | done |
| A2 | Collection case statuses: OPEN / PROMISE_TO_PAY / BROKEN_PROMISE / DISPUTED / ESCALATED / PAID / CLOSED. A case opens automatically when a payment is DUE and closes when PAID or WAIVED. | done |
| A3 | Contract statuses: DRAFT / PENDING_APPROVAL / ACTIVE / EXPIRING_SOON / RENEWAL_PENDING / RENEWED / EXPIRED / TERMINATED / CANCELLED. Approval required only when the creator lacks `contracts.approve`. | done |
| A4 | Priority score for claims (amount, lateness, broken promises, silence, contract end, tenant risk) is explained on screen. | done |
| A5 | Tenant late-payment indicator is deterministic and explained (12-month history). | done |
| A6 | Money is rounded to 2 decimals at every write (`r2`). Schedules put the rounding remainder on the last installment. | done |
| A7 | Codes (PRP-0001 …) come from an atomic per-office counter; two users saving at once never collide. | done |
| A8 | Engine (statuses, cases, reminders) runs from cron every 15 min; pages only trigger it at most every 10 min. | done |
| A9 | Payments once APPROVED are immutable without `payments.approve`; reversal creates a REVERSED record. | done |
| A10 | Owner statement = collected rent × ownership % − management fee − approved expenses share, per period. Approve → transfer → close. | done |
| A11 | Move money columns from Float to Decimal(14,2). Safe today because of A6, but Decimal is the correct type for a ledger. Requires a data migration and touching every arithmetic site. | todo (post-launch) |
| A12 | Payment plan / partial settlement agreements (تقسيط المتأخرات) as a first-class object instead of a promise note. | later, if asked |
| A13 | Deposits (التأمين) are handled outside the system by decision. No field, no flow. | closed |
| A14 | VAT: commercial rent carries 15% VAT; residential is exempt. Contract `vatAmount` exists; receipts should print VAT lines and the office VAT number. | todo |

## B. Backend and data

| # | Rule | Status |
|---|---|---|
| B1 | Every query filters by `organizationId`; scoped roles add `propertyScope`. Smoke test proves isolation across orgs and roles on every run. | done |
| B2 | Every mutation is audited (who, what, before, after). | done |
| B3 | PostgreSQL in production, SQLite in dev. One PostgreSQL migration (`0001_init`, the full schema) is checked in under `packages/db/prisma/schema/migrations`; later changes use `migrate:new`. | done — **needs owner**: a Postgres URL to run `migrate deploy` once and confirm zero drift |
| B4 | Sessions: signed JWT in httpOnly cookie, DB-backed with revocation, 5-attempt login lockout, optional TOTP MFA, password policy. | done |
| B5 | Security headers: CSP, HSTS, nosniff, frame-ancestors self, permissions-policy. | done |
| B6 | Uploads: 20 MB cap, MIME allow-list, magic-byte check, private serving through `/api/files` with auth. | done |
| B7 | Structured JSON logs; errors forwarded to Sentry when `SENTRY_DSN` is set; `/api/health` checks the DB. | done |
| B8 | Nightly `pg_dump` backup container with retention; restore drill documented in RUNBOOK. | done — **needs owner**: run one restore drill on the real host |
| B9 | Rate limits on login, reset, signup (DB-backed, no Redis). | done |
| B10 | Cron secret required in production; cron runs engine + housekeeping. | done |
| B11 | Automated tests: engine rules (schedule, statuses, grace, enforcement, risk, priority) and permissions; route smoke with isolation. | done |
| B12 | Integration tests against a real Postgres in CI (payments allocation, statement maths, case lifecycle). | todo |
| B13 | Load check: 2,000 units / 8,000 installments — engine run < 30 s, dashboard < 1.5 s. Add `Installment(organizationId,status,dueDate)` composite index if needed. | todo |
| B14 | PDPL: privacy notice, data-processing register page, export/delete tenant data on request. Notice exists; export/delete flow does not. | todo |
| B15 | Self-service signup: keep for trials or invite-only? | needs owner |

## C. Frontend

| # | Rule | Status |
|---|---|---|
| C1 | Seven-item daily menu; everything else under المزيد. | done |
| C2 | Dashboard = money row, today's work, worst properties, expiring contracts, top claims. No charts for their own sake. | done |
| C3 | Property page holds everything: brief, ownership, this-year figures, attention list, tasks; tabs for units, contracts, collections, expenses, financials, documents, activity. | done |
| C4 | Collections: property board → property workspace → side drawer with every action. Flat list kept for saved views and bulk assign. | done |
| C5 | Route-level loading skeletons (staff, owner, tenant). | done |
| C6 | Hijri date shown next to Gregorian where a Saudi user expects it (dashboard, receipts). | dashboard done; receipts todo |
| C7 | Every list: search, GET filters, chips, pagination, empty state with one CTA. Every form: essentials first, extras collapsed, human errors. | done (audit remaining forms each release) |
| C8 | Mobile: sidebar drawer, tables scroll, primary action reachable with one thumb. Owner and tenant portals are phone-first. | done — verify on real devices |
| C9 | Accessibility: labels on inputs, status always has a text label, focus rings, no colour-only signals. | done — run an axe pass before launch |
| C10 | Printable سند قبض and كشف حساب with office logo, CR/VAT numbers, QR of receipt code. | partial (print pages exist, no QR/VAT block) |
| C11 | Empty-org onboarding: first login shows a 4-step checklist (office data → owner → property + units → first contract). | todo |

## D. Integrations

| # | Item | Status |
|---|---|---|
| D1 | WhatsApp Cloud API, SMS (Unifonic/Msegat), email (Resend): simulated until keys exist; every send logged on the claim. | done — **needs owner**: accounts and sender approval (WhatsApp template approval takes days) |
| D2 | Online tenant payments: removed by decision. Tenants pay by bank transfer; the office records the receipt. | closed |
| D3 | Bank statement import for reconciliation (CSV). | done |
| D4 | Assistant (Gemini free tier): property brief, daily brief, reminder drafts. Built-in text without a key. | done — **needs owner**: `GEMINI_API_KEY` |
| D5 | ZATCA e-invoicing: removed by decision. Revisit only if an office issues tax invoices from DARAK. | closed |
| D6 | Ejar: removed by decision. Re-add only with official API access. | closed |

## E. Operations and launch

| # | Item | Status |
|---|---|---|
| E1 | Docker Compose stack (Postgres, app, Caddy TLS, cron, backup) and Vercel config. | done |
| E2 | `.env` filled: `AUTH_SECRET` (64+ chars), `CRON_SECRET`, `APP_URL`, `DATABASE_URL`, `COOKIE_SECURE=true`. | **needs owner** |
| E3 | Domain + DNS to the host; Caddy gets the certificate automatically. | **needs owner** |
| E4 | Hosting: Vercel + Neon Postgres + Cloudflare R2 for uploads (Vercel's disk is not persistent). | decided — see DEPLOYMENT.md |
| E5 | Demo seed disabled in production (`pnpm db:seed` never run against prod). | done (documented) |
| E6 | Runbook: cron failure, integration errors, restore, rotating secrets. | done |
| E7 | Uptime monitor on `/api/health`, alert to a phone. | needs owner (which channel) |
| E8 | First real office: import owners → properties → units → tenants → contracts from Excel with the templates in /import, then a 2-week parallel run with their old sheets. | needs owner |

---

## Definition of "production ready" for v1

- [x] Typecheck, unit tests, build and smoke (all routes, all roles, isolation) pass on every commit.
- [x] No status, module or screen exists that a Saudi office manager would not use weekly.
- [x] Every action that moves money is audited, reversible, and impossible to duplicate under concurrency.
- [ ] Postgres migration applied on a real database with a restore drill done (B3, B8).
- [ ] Messaging keys installed and one real WhatsApp reminder delivered end to end (D1).
- [ ] One real office imported and running in parallel for two weeks (E8).
- [ ] Decimal migration scheduled after real data exists (A11).

## Order of work after this commit

1. B3 + B8 on the real host (one afternoon, needs the owner's Postgres URL).
2. C10 receipts with VAT/QR + C6 Hijri on receipts (two days).
3. C11 onboarding checklist (one day).
4. B12 Postgres integration tests in CI (two days).
5. A11 Decimal migration (three days, after real data is in).
